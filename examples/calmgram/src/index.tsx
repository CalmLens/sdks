import { CalmLensError } from "@calmlens/sdk";
import { type Context, Hono } from "hono";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { DailyLimitReached } from "./budget";
import { CalmLensIcon } from "./CalmLensIcons";
import {
  addComment,
  attachUpload,
  createPost,
  deleteComment,
  deletePost,
  isPublished,
  isVisibleTo,
  loadFeed,
  MAX_IMAGE_BYTES,
  MAX_POSTS_PER_SANDBOX,
  ModerationRejection,
  postMediaFor,
  refreshPending,
  retryPost,
  startUpload,
  syncAsset,
  toggleLike,
  UnknownUpload,
  updateBio,
  viewerOf,
} from "./content";
import type { Comment, Env, ModerationFields, Post, Sandbox } from "./data";
import {
  EXAMPLE_AUTHORS,
  EXAMPLE_POSTS_BY_ID,
  exampleContentType,
  isExamplePhoto,
} from "./examples";
import { getModeration, isLoopbackHost, ModerationNotConfigured } from "./moderation";
import { describeCalmLensError } from "./moderation/calmlens";
import { readDemoPlaceholder, readDemoUpload } from "./moderation/demo";
import {
  CATEGORY_LABELS,
  describeFindings,
  isShownToEveryone,
  type ModerationStatus,
} from "./moderation/types";
import { encodePng } from "./png";
import {
  currentSandbox,
  deleteExpiredSandboxes,
  endSession,
  ensureSandbox,
  flash,
  saveSandbox,
  takeFlash,
} from "./sandbox";
import {
  DEMO_TEST_INPUT_KEY,
  paintTestImage,
  TEST_INPUT_KEY_PATTERN,
  testTextCode,
} from "./testInputs";
import { requireHuman } from "./turnstile";
import {
  Avatar,
  buttonClass,
  CalmLensPanel,
  cx,
  Decision,
  Findings,
  FlashMessage,
  FormError,
  Layout,
  logoClass,
  PostButton,
  PostCaption,
  PostCard,
  PostImage,
  panelClass,
  QueueScores,
  QueueTypeIcon,
  sensitiveMediaSettingHref,
  timeAgo,
} from "./views";
import { readWebhookDelivery } from "./webhooks";

const FEED = "mx-auto grid max-w-[470px] gap-5";
const CARD = cx(panelClass, "mx-auto max-w-[470px] p-6");
const ROW = "mt-2 flex flex-wrap items-center gap-3";
const EMPTY = "px-4 py-12 text-center";

type AppContext = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

// Fail closed: without CalmLens keys nothing would be moderated, so refuse to serve unless demo
// mode was asked for, and keep the simulator to localhost unless that is explicitly allowed.
app.use("*", async (c, next) => {
  let mode: "calmlens" | "demo";
  try {
    mode = getModeration(c.env).mode;
  } catch (error) {
    if (!(error instanceof ModerationNotConfigured)) throw error;
    console.error("[calmgram]", error.message);
    return c.text("Calmgram isn't configured yet.", 503);
  }
  if (
    mode === "demo" &&
    c.env.CALMLENS_DEMO_ALLOW_REMOTE !== "1" &&
    !isLoopbackHost(new URL(c.req.url).hostname)
  ) {
    console.error("[calmgram] demo mode only serves localhost; set CALMLENS_DEMO_ALLOW_REMOTE=1");
    return c.text("Calmgram isn't configured yet.", 503);
  }
  await next();
});

// Every form submission can call CalmLens, so limit them per visitor IP. CalmLens's own webhook
// deliveries are verified by signature instead.
app.use("*", async (c, next) => {
  if (c.req.method === "POST" && !c.req.path.startsWith("/api/webhooks/") && c.env.WRITE_LIMITER) {
    const key = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await c.env.WRITE_LIMITER.limit({ key });
    if (!success) return c.text("You're doing that too often. Please wait a minute.", 429);
  }
  await next();
});

// On the public demo, a Turnstile check keeps crawlers from creating sandboxes (see turnstile.ts).
app.use("*", requireHuman);

const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
const TEST_IMAGES = [
  ["violence", "Violence"],
  ["harassment", "Harassment"],
  ["hate", "Hate"],
  ["criminal-activity", "Criminal activity"],
  ["sexual", "Sexual content"],
  ["self-harm", "Self-harm"],
] as const;

const page = async (
  c: AppContext,
  sandbox: Sandbox | null,
  title: string | undefined,
  body: Child,
) =>
  c.html(
    <Layout
      title={title}
      username={sandbox?.username ?? null}
      demo={getModeration(c.env).mode === "demo"}
      panel={await moderationQueue(c, sandbox)}
    >
      {body}
    </Layout>,
  );

/** Sends the visitor back where they came from, if that was this site. */
const back = (c: AppContext, fallback = "/") => {
  const referer = c.req.header("referer");
  const url = referer ? new URL(referer) : null;
  return c.redirect(
    url && url.origin === new URL(c.req.url).origin ? url.pathname + url.hash : fallback,
    303,
  );
};

/** Turns a failed moderation call into a message for the visitor. */
const toError = (error: unknown) => {
  if (error instanceof ModerationRejection) return error.message;
  if (error instanceof UnknownUpload)
    return "That upload didn't work. Please choose the photo again.";
  if (error instanceof DailyLimitReached) {
    return "The Calmgram demo has reached today's limit. Please try again tomorrow.";
  }
  console.error("[calmgram] moderation request failed:", describeCalmLensError(error));
  return "We couldn't check that right now. Please try again.";
};

/** The home feed, also drawn underneath the moderation queue. */
const feedView = async (c: AppContext, sandbox: Sandbox | null) => {
  const viewer = sandbox?.username ?? null;
  const viewing = viewerOf(sandbox);
  const feed = await loadFeed(c.env, sandbox);
  const posts = await refreshPending(
    c.env,
    sandbox,
    feed.posts.filter((post) => isVisibleTo(post, viewer)),
  );
  // The feed shows published posts (age-restricted ones behind a placeholder unless the viewer
  // turned on sensitive media), and the viewer's own posts that aren't published, with why. Of
  // the shared examples, it shows the photos.
  const visible = posts.filter((post) => !post.exampleId || isExamplePhoto(post));
  return (
    <div class={FEED}>
      {visible.length === 0 && (
        <div class={EMPTY}>
          <h1>No posts yet</h1>
          <p>Share the first photo. It'll appear once CalmLens has checked it.</p>
          <a href="/new" class={buttonClass()}>
            New post
          </a>
        </div>
      )}
      {visible.map((post) => (
        <PostCard
          post={post}
          {...mediaProps(postMediaFor(c.env, post, "feed", viewing))}
          comments={feed.comments.filter((comment) => comment.postId === post.id)}
          likes={feed.likesFor(post.id)}
          viewer={viewer}
        />
      ))}
    </div>
  );
};

/** PostCard's photo props from a post's media. */
const mediaProps = (media: ReturnType<typeof postMediaFor>) => ({
  imageUrl: media.url,
  placeholderUrl: media.placeholderUrl,
});

/** PostImage's photo props from a post's media. */
const thumbProps = (media: ReturnType<typeof postMediaFor>) => ({
  url: media.url,
  placeholderUrl: media.placeholderUrl,
});

/** The profile's "Show sensitive media" setting, with its over-18 confirmation. */
const SensitiveMediaSetting = ({ enabled }: { enabled: boolean }) => (
  <form
    id="sensitive-media"
    method="post"
    action="/settings/sensitive-media"
    class="mt-4 max-w-[360px] border-t border-line pt-3"
  >
    <label class="flex items-start gap-2">
      <input type="checkbox" name="showSensitiveMedia" checked={enabled} class="mt-1" />
      <span>
        <strong>Show sensitive media</strong>
        <br />I confirm I'm 18 or older. Photos CalmLens age-restricts are shown blurred until you
        turn this on.
      </span>
    </label>
    <div class={ROW}>
      <button type="submit" class={buttonClass("secondary")}>
        Save setting
      </button>
    </div>
  </form>
);

app.get("/", async (c) => {
  const sandbox = await ensureSandbox(c);
  return page(c, sandbox, undefined, await feedView(c, sandbox));
});

// Old links to the sign-in page land on the username page.
app.get("/login", (c) => c.redirect("/username", 301));

// Errors travel as fixed codes, so the page never shows text taken from the URL.
const USERNAME_ERRORS = {
  invalid: "Use 3–24 lowercase letters, numbers, dots or underscores.",
  taken: "That username is taken. Try another.",
} as const;

app.get("/username", async (c) => {
  const sandbox = await ensureSandbox(c);
  const errorCode = c.req.query("error");
  const error =
    errorCode && Object.hasOwn(USERNAME_ERRORS, errorCode)
      ? USERNAME_ERRORS[errorCode as keyof typeof USERNAME_ERRORS]
      : null;
  return page(
    c,
    sandbox,
    "Change username",
    <div class={cx(panelClass, "mx-auto mt-10 max-w-[360px] p-6")}>
      <h1 class={cx(logoClass, "text-center text-[44px]")}>Calmgram</h1>
      <p class="text-muted">
        You were given a random username so you can try the app straight away. Pick another if you
        like. There are no passwords in this demo.
      </p>
      <form method="post" action="/username" class="grid gap-2.5">
        <input
          name="username"
          value={sandbox?.username ?? ""}
          placeholder="username"
          autocomplete="username"
          required
          aria-label="Username"
        />
        {error && <FormError>{error}</FormError>}
        <button type="submit" class={buttonClass()}>
          Save username
        </button>
      </form>
    </div>,
  );
});

app.post("/username", async (c) => {
  const username = String((await c.req.formData()).get("username") ?? "")
    .trim()
    .toLowerCase();
  const error: keyof typeof USERNAME_ERRORS | null = !USERNAME_PATTERN.test(username)
    ? "invalid"
    : EXAMPLE_AUTHORS.has(username)
      ? "taken"
      : null;
  if (error) return c.redirect(`/username?error=${error}`, 303);
  // Sandboxes are only created by page views, so scripted POSTs can't create them in bulk.
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  // Renaming keeps the same sandbox.
  sandbox.username = username;
  await saveSandbox(c.env, sandbox);
  return c.redirect(`/u/${username}`, 303);
});

// Drops this sandbox; the next page creates a fresh one with a new random username. The old one
// is deleted by the hourly cleanup like any other.
app.post("/start-over", (c) => {
  endSession(c);
  return c.redirect("/", 303);
});

app.get("/test-inputs/:file", async (c) => {
  const file = c.req.param("file");
  const image = TEST_IMAGES.find(([name]) => file === `calmlens-test-${name}.png`);
  if (!image) return c.notFound();
  const key =
    getModeration(c.env).mode === "demo" ? DEMO_TEST_INPUT_KEY : c.env.CALMLENS_TEST_INPUT_KEY;
  if (!key || !TEST_INPUT_KEY_PATTERN.test(key))
    return c.text("Test inputs are not configured for this project.", 503);
  const signal = image[0];
  const pixels = await paintTestImage(signal, key);
  return c.body(new Uint8Array(encodePng(pixels.width, pixels.height, pixels.rgba)).buffer, 200, {
    "Content-Type": "image/png",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${file}"`,
  });
});

app.get("/new", async (c) => {
  const sandbox = await ensureSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  const message = await takeFlash(c.env, sandbox);
  const moderation = getModeration(c.env);
  const demo = moderation.mode === "demo";
  // Test inputs use category-specific authentication tags; the simulator has its own.
  const testInputKey = demo ? DEMO_TEST_INPUT_KEY : (c.env.CALMLENS_TEST_INPUT_KEY ?? "");
  return page(
    c,
    sandbox,
    "New post",
    <div class={CARD}>
      <h1>New post</h1>
      <form
        id="new-post"
        class="grid gap-3"
        method="post"
        action="/posts"
        enctype="multipart/form-data"
        // With an upload preset, /upload.js sends the photo straight to CalmLens. Without
        // JavaScript (or a preset), the form posts the photo here instead.
        data-upload-preset-id={moderation.uploadPresetId ?? undefined}
        data-calmlens-api-url={c.env.CALMLENS_API_URL || undefined}
      >
        <label
          id="dropzone"
          class="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line text-center text-muted"
        >
          <span id="dropzone-hint">
            <strong>Choose a photo</strong>
            <br />
            JPEG, PNG, WebP, GIF or HEIC, up to 10MB
          </span>
          <img id="preview" alt="Selected photo preview" class="size-full object-cover" hidden />
          <input
            type="file"
            name="image"
            id="image"
            accept={ACCEPTED_TYPES.join(",")}
            class="absolute inset-0 cursor-pointer opacity-0"
            required
          />
        </label>
        <PostCaption draft={message?.draft} prefill={c.req.query("caption")} />
        <FlashMessage flash={message} />
        <p id="upload-error" class="mt-1.5 mb-0 text-danger" role="alert" hidden />
        <button type="submit" class={buttonClass()} id="share">
          Share
        </button>
      </form>
      {raw(`<script>
        const input = document.getElementById("image");
        const preview = document.getElementById("preview");
        input.addEventListener("change", () => {
          const file = input.files[0];
          if (!file) return;
          if (file.size >= ${MAX_IMAGE_BYTES}) { alert("Images must be smaller than 10MB."); input.value = ""; return; }
          preview.src = URL.createObjectURL(file);
          preview.hidden = false;
          document.getElementById("dropzone-hint").hidden = true;
          document.getElementById("dropzone").classList.replace("border-dashed", "border-solid");
        });
        document.getElementById("new-post").addEventListener("submit", () => {
          const button = document.getElementById("share");
          button.disabled = true;
          button.textContent = "Uploading…";
        });
      </script>`)}
      {moderation.uploadPresetId && <script type="module" src="/upload.js" />}
      <details class="mt-5 border-t border-line pt-3.5">
        <summary class="cursor-pointer font-semibold">
          Want to see a post or comment get blocked?
        </summary>
        <p>
          These harmless images are CalmLens <em>test triggers</em>: CalmLens classifies each one as
          the named category, so you can see what happens to content that isn't allowed without
          uploading real harmful content.
        </p>
        {TEST_INPUT_KEY_PATTERN.test(testInputKey) ? (
          <ul class="grid grid-cols-4 gap-2">
            {TEST_IMAGES.map(([file, label]) => (
              <li>
                <a
                  href={`/test-inputs/calmlens-test-${file}.png`}
                  class="grid gap-1 text-center text-xs"
                  download
                >
                  <img
                    src={`/test-inputs/calmlens-test-${file}.png`}
                    alt=""
                    class="aspect-square w-full rounded-lg"
                  />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p class="text-muted">
            Set CALMLENS_TEST_INPUT_KEY to enable test inputs for this project.
          </p>
        )}
        {TEST_INPUT_KEY_PATTERN.test(testInputKey) && (
          <p>
            For text, paste a test code into a caption, comment or bio:
            <br />
            <code>{await testTextCode("harassment", testInputKey)}</code>
          </p>
        )}
        {demo && (
          <p class="text-muted">
            In demo mode, threats like “I'll hurt you” are blocked, and the sexual test image is
            age-restricted: it's published behind a blurred placeholder unless you turn on{" "}
            <a href={sensitiveMediaSettingHref(sandbox.username)}>Show sensitive media</a>.
          </p>
        )}
      </details>
    </div>,
  );
});

/** Why a new post can't be started yet, or null. */
const postLimitError = (sandbox: Sandbox) =>
  sandbox.posts.length >= MAX_POSTS_PER_SANDBOX
    ? `This demo allows ${MAX_POSTS_PER_SANDBOX} posts. Delete one to share another.`
    : null;

// Step 1 of a browser upload: check who is asking, then sign a single-use upload token for a new
// post. In your app, this is where you check the signed-in user and what they may upload.
app.post("/api/uploads", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.json({ error: "Reload the page and try again." }, 401);
  if (!getModeration(c.env).uploadPresetId) return c.json({ error: "Not found" }, 404);
  const limit = postLimitError(sandbox);
  if (limit) return c.json({ error: limit }, 409);
  try {
    return c.json(await startUpload(c.env, sandbox));
  } catch (error) {
    return c.json({ error: toError(error) }, error instanceof DailyLimitReached ? 429 : 502);
  }
});

// Creates a post. With JavaScript and an upload preset, the browser has already uploaded the
// photo to CalmLens and sends its asset ID (step 2); otherwise the photo itself is posted here.
app.post("/posts", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  const form = await c.req.formData();
  const image = form.get("image");
  const assetId = String(form.get("assetId") ?? "");
  const postId = String(form.get("postId") ?? "");
  const caption = String(form.get("caption") ?? "");
  const fail = async (error: string) => {
    await flash(c.env, sandbox, { error, draft: caption });
    return c.redirect("/new", 303);
  };

  if (caption.length > 2200) return fail("Captions can be up to 2,200 characters.");
  const limit = postLimitError(sandbox);
  if (limit) return fail(limit);

  if (assetId || postId) {
    if (!assetId || !postId) return fail("Choose a photo to share.");
    try {
      const post = await attachUpload(c.env, sandbox, { postId, assetId, caption });
      return c.redirect(`/p/${post.id}`, 303);
    } catch (error) {
      return fail(toError(error));
    }
  }

  if (!(image instanceof File) || image.size === 0) return fail("Choose a photo to share.");
  if (!ACCEPTED_TYPES.includes(image.type))
    return fail("Use a JPEG, PNG, WebP, GIF or HEIC image.");
  if (image.size >= MAX_IMAGE_BYTES) return fail("Images must be smaller than 10MB.");

  try {
    const post = await createPost(c.env, sandbox, { caption, image });
    return c.redirect(`/p/${post.id}`, 303);
  } catch (error) {
    return fail(toError(error));
  }
});

app.get("/p/:id", async (c) => {
  const sandbox = await ensureSandbox(c);
  const viewer = sandbox?.username ?? null;
  const feed = await loadFeed(c.env, sandbox);
  const stored = feed.posts.find((post) => post.id === c.req.param("id"));
  if (!stored || !isVisibleTo(stored, viewer)) return c.notFound();
  const [post] = await refreshPending(c.env, sandbox, [stored]);
  const message = await takeFlash(c.env, sandbox);
  const comments = feed.comments.filter((comment) => comment.postId === post.id);
  const visible = comments
    .filter((comment) => isShownToEveryone(comment.status))
    .sort((a, b) => a.createdAt - b.createdAt);

  return page(
    c,
    sandbox,
    post.caption || `Post by ${post.author}`,
    <div class={FEED}>
      <PostCard
        post={post}
        {...mediaProps(postMediaFor(c.env, post, "feed", viewerOf(sandbox)))}
        comments={comments}
        likes={feed.likesFor(post.id)}
        viewer={viewer}
        linkToPost={false}
      />
      {!isPublished(post) && <FlashMessage flash={message} class="px-3" />}
      {isPublished(post) && (
        <section id="comments" class={cx(panelClass, "grid gap-2.5 p-3 max-sm:px-4")}>
          {visible.length === 0 && <p class="text-muted">No comments yet.</p>}
          {visible.map((comment) => (
            <div class="flex items-start gap-2">
              <Avatar username={comment.author} size={24} />
              <p class="my-0.5">
                <a href={`/u/${comment.author}`} class="font-semibold">
                  {comment.author}
                </a>{" "}
                {comment.text}
                <span class="text-muted"> · {timeAgo(comment.createdAt)}</span>
              </p>
            </div>
          ))}
          {viewer ? (
            <form
              method="post"
              action={`/p/${post.id}/comments`}
              class="grid grid-cols-[1fr_auto] gap-2 border-t border-line pt-2.5"
            >
              <input
                class="border-0 px-0 py-1.5 focus:outline-none"
                name="text"
                value={message?.draft ?? ""}
                placeholder="Add a comment…"
                maxlength={500}
                autocomplete="off"
                required
                aria-label="Add a comment"
              />
              <button
                type="submit"
                class="cursor-pointer text-sm font-semibold text-accent disabled:opacity-50"
              >
                Post
              </button>
              <FlashMessage flash={message} class="col-span-full" />
            </form>
          ) : null}
        </section>
      )}
      {post.author === viewer && !post.exampleId && isPublished(post) && (
        <div class={cx(ROW, "justify-end")}>
          <PostButton
            action={`/p/${post.id}/delete`}
            confirm={{ title: "Delete this post?", action: "Delete" }}
          >
            Delete post
          </PostButton>
        </div>
      )}
    </div>,
  );
});

// A photo whose processing failed can be checked again; it goes back to pending.
app.post("/p/:id/retry", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  try {
    await retryPost(c.env, sandbox, c.req.param("id"));
  } catch (error) {
    await flash(c.env, sandbox, { error: toError(error) });
  }
  return c.redirect(`/p/${c.req.param("id")}`, 303);
});

app.post("/p/:id/like", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  await toggleLike(c.env, sandbox, c.req.param("id"));
  return back(c);
});

app.post("/p/:id/comments", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  const postId = c.req.param("id");
  const text = String((await c.req.formData()).get("text") ?? "").trim();
  const target = `/p/${postId}#comments`;
  if (!text) return c.redirect(target, 303);
  if (text.length > 500) {
    await flash(c.env, sandbox, { error: "Comments can be up to 500 characters.", draft: text });
    return c.redirect(target, 303);
  }
  try {
    await addComment(c.env, sandbox, { postId, text });
  } catch (error) {
    // A comment that wasn't allowed stays in the box so its author can edit it.
    await flash(c.env, sandbox, { error: toError(error), draft: text });
  }
  return c.redirect(target, 303);
});

app.post("/p/:id/delete", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  const fromModeration = c.req.header("referer")?.includes("/moderation");
  await deletePost(c.env, sandbox, c.req.param("id"));
  return c.redirect(fromModeration ? "/moderation" : `/u/${sandbox.username}`, 303);
});

app.post("/comments/:id/delete", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  await deleteComment(c.env, sandbox, c.req.param("id"));
  return back(c, "/moderation");
});

app.get("/u/:username", async (c) => {
  const username = c.req.param("username");
  const sandbox = await ensureSandbox(c);
  const viewer = sandbox?.username ?? null;
  const feed = await loadFeed(c.env, sandbox);
  const authored = feed.posts.filter((post) => post.author === username);
  if (authored.length === 0 && username !== viewer && !EXAMPLE_AUTHORS.has(username))
    return c.notFound();
  const isOwner = viewer === username;
  const posts = await refreshPending(
    c.env,
    sandbox,
    authored.filter((post) => isVisibleTo(post, viewer)),
  );
  const published = posts.filter(isPublished).length;
  const viewing = viewerOf(sandbox);
  const message = isOwner ? await takeFlash(c.env, sandbox) : null;
  const bio = isOwner ? (message?.draft ?? feed.bioFor(username)) : feed.bioFor(username);

  return page(
    c,
    sandbox,
    username,
    <div class="max-sm:px-4">
      <header class="mb-1 flex items-start gap-8 border-b border-line pt-2 pb-7 max-sm:gap-4">
        <Avatar username={username} size={88} class="max-sm:size-16! max-sm:text-[27px]!" />
        <div class="min-w-0 flex-1">
          <h1>{username}</h1>
          {isOwner && (
            <p>
              <a href="/username" class="text-muted">
                Change username
              </a>
            </p>
          )}
          <p>
            <strong>{published}</strong> {published === 1 ? "post" : "posts"}
          </p>
          {isOwner ? (
            <form method="post" action="/bio" class="mt-2 max-w-[360px]">
              <textarea
                name="bio"
                maxlength={150}
                rows={2}
                placeholder="Write a bio…"
                aria-label="Bio"
              >
                {bio}
              </textarea>
              <div class={ROW}>
                <button type="submit" class={buttonClass("secondary")}>
                  Save bio
                </button>
              </div>
              <FlashMessage flash={message} />
            </form>
          ) : (
            bio && <p>{bio}</p>
          )}
          {isOwner && sandbox && <SensitiveMediaSetting enabled={!!sandbox.showSensitiveMedia} />}
        </div>
      </header>
      {posts.length === 0 ? (
        <p class={cx(EMPTY, "text-muted")}>No posts yet.</p>
      ) : (
        <div class="grid grid-cols-3 gap-1">
          {posts.map((post) => (
            <a
              href={`/p/${post.id}`}
              class="block aspect-square overflow-hidden bg-subtle"
              title={isPublished(post) ? post.caption : `Status: ${post.status}`}
            >
              <PostImage
                post={post}
                variant="thumb"
                {...thumbProps(postMediaFor(c.env, post, "thumb", viewing))}
              />
            </a>
          ))}
        </div>
      )}
    </div>,
  );
});

app.post("/bio", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  const bio = String((await c.req.formData()).get("bio") ?? "");
  const target = `/u/${sandbox.username}`;
  if (bio.length > 150) {
    await flash(c.env, sandbox, { error: "Bios can be up to 150 characters.", draft: bio });
    return c.redirect(target, 303);
  }
  try {
    await updateBio(c.env, sandbox, bio);
    await flash(c.env, sandbox, { notice: "Saved" });
  } catch (error) {
    await flash(c.env, sandbox, { error: toError(error), draft: bio });
  }
  return c.redirect(target, 303);
});

// "Show sensitive media": the visitor confirms they are 18 or older. This stands in for your app's
// real age check; only viewers with it on get age-restricted photos' `ageConfirmed=true` URLs.
app.post("/settings/sensitive-media", async (c) => {
  const sandbox = await currentSandbox(c);
  if (!sandbox) return c.redirect("/", 303);
  sandbox.showSensitiveMedia = (await c.req.formData()).get("showSensitiveMedia") === "on";
  await saveSandbox(c.env, sandbox);
  return c.redirect(sensitiveMediaSettingHref(sandbox.username), 303);
});

// Demo-only review tools: each visitor sees only their own sandbox. A production app
// should keep these tools in a separate, authenticated admin interface.

/** Queue sections, in order: still being checked, flagged by the policy, then allowed. */
const QUEUE_SECTIONS = [
  { title: "Checking", statuses: ["pending"] },
  { title: "Flagged", statuses: ["limited", "age-restricted", "blocked", "purged", "error"] },
  { title: "Allowed", statuses: ["allowed"] },
] satisfies { title: string; statuses: ModerationStatus[] }[];

export type QueueEntry = { kind: "post"; item: Post } | { kind: "comment"; item: Comment };

/** A CalmLens test input names its category in plain text, after its authentication tag. */
const TEST_TEXT_CODE = /^<!calmlens-test [0-9a-f]+ ([a-z-]+)>$/;

/** What a queue entry is called: its caption or text, or an example's label when it's hidden. */
export const queueName = (entry: QueueEntry) => {
  if (entry.kind === "comment") {
    const testCategory = TEST_TEXT_CODE.exec(entry.item.text.trim())?.[1];
    return testCategory ? `Test input: ${testCategory}` : entry.item.text;
  }
  const example = entry.item.exampleId ? EXAMPLE_POSTS_BY_ID.get(entry.item.exampleId) : null;
  if (example && !isShownToEveryone(entry.item.status)) return example.label;
  return entry.item.caption || "Photo";
};

/** The category behind a flagged decision, such as "Harassment 93%". */
const flaggedReason = (item: ModerationFields) => {
  const [top] = item.findings;
  if (isShownToEveryone(item.status) && item.status !== "limited") return null;
  if (!top || top.score < 0.5) return null;
  const label = CATEGORY_LABELS[top.category] ?? top.category;
  return `${label[0].toUpperCase()}${label.slice(1)} ${Math.round(top.score * 100)}%`;
};

const QueueCard = ({
  c,
  entry,
  viewer,
}: {
  c: AppContext;
  entry: QueueEntry;
  viewer: ReturnType<typeof viewerOf>;
}) => {
  const { item } = entry;
  const example = entry.kind === "post" && !!entry.item.exampleId;
  const hasPicture =
    entry.kind === "post" && (!entry.item.exampleId || exampleContentType(entry.item) !== "Text");
  const reason = flaggedReason(item);
  return (
    // Each card is a link target, such as /#queue-<asset ID>.
    <details class="queue-card" id={`queue-${item.assetId}`}>
      <summary class="queue-summary">
        <span class="queue-preview">
          {hasPicture && entry.kind === "post" ? (
            <PostImage
              post={entry.item}
              variant="thumb"
              {...thumbProps(postMediaFor(c.env, entry.item, "thumb", viewer))}
            />
          ) : (
            <span class="queue-text-preview" aria-hidden="true">
              {isShownToEveryone(item.status) ? (
                <>
                  <QueueTypeIcon kind="comment" />
                  <span>{queueName(entry)}</span>
                </>
              ) : (
                // Text that wasn't allowed isn't previewed; open the card to read it.
                <span class="queue-hidden">
                  <CalmLensIcon name="blocked" />
                </span>
              )}
            </span>
          )}
        </span>
        <span class="queue-body">
          <span class="queue-row">
            <span class="queue-name">{queueName(entry)}</span>
            <Decision item={item} />
          </span>
          <QueueScores item={item} />
          <span class="queue-meta">
            {[
              entry.kind === "post" ? exampleContentType(entry.item) : "Comment",
              reason,
              timeAgo(item.createdAt),
              example ? "Example" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </summary>
      <div class="queue-detail">
        <p class="text-muted">
          By <a href={`/u/${item.author}`}>{item.author}</a>
          {" · "}
          {entry.kind === "post" ? (
            isPublished(entry.item) || !example ? (
              <a href={`/p/${entry.item.id}`}>View post</a>
            ) : (
              "Never published"
            )
          ) : (
            <a href={`/p/${entry.item.postId}#comments`}>View post</a>
          )}
        </p>
        {entry.kind === "comment" ? (
          <blockquote>{entry.item.text}</blockquote>
        ) : (
          entry.item.caption &&
          (!example || isShownToEveryone(item.status)) && (
            <blockquote>{entry.item.caption}</blockquote>
          )
        )}
        <Findings item={item} />
        {!example && (
          <div class={ROW}>
            {entry.kind === "post" && item.status === "error" && (
              <PostButton action={`/p/${item.id}/retry`} class={buttonClass("secondary", "small")}>
                Try again
              </PostButton>
            )}
            <PostButton
              action={
                entry.kind === "post" ? `/p/${item.id}/delete` : `/comments/${item.id}/delete`
              }
              class={buttonClass("danger", "small")}
              confirm={
                entry.kind === "post"
                  ? { title: "Remove this post and its image?", action: "Remove" }
                  : undefined
              }
            >
              Remove {entry.kind}
            </PostButton>
          </div>
        )}
      </div>
    </details>
  );
};

const moderationQueue = async (c: AppContext, sandbox: Sandbox | null) => {
  const posts = await refreshPending(c.env, sandbox, (await loadFeed(c.env, sandbox)).posts);
  const viewer = viewerOf(sandbox);
  // Calmgram is a photo app, so its queue leaves out the shared examples of other media.
  const entries: QueueEntry[] = [
    ...posts
      .filter((post) => !post.exampleId || ["Image", "Text"].includes(exampleContentType(post)))
      .map((item) => ({ kind: "post" as const, item })),
    ...(sandbox?.comments ?? []).map((item) => ({ kind: "comment" as const, item })),
  ].sort((a, b) => b.item.createdAt - a.item.createdAt);

  return (
    <CalmLensPanel title="Moderation queue">
      {QUEUE_SECTIONS.map(({ title, statuses }) => {
        const section = entries.filter((entry) =>
          (statuses as ModerationStatus[]).includes(entry.item.status),
        );
        if (section.length === 0) return null;
        return (
          <section class="queue-section" aria-label={title}>
            <h3 class="queue-heading">
              {title}
              <span class="queue-count">{section.length}</span>
            </h3>
            {section.map((entry) => (
              <QueueCard c={c} entry={entry} viewer={viewer} />
            ))}
          </section>
        );
      })}
    </CalmLensPanel>
  );
};

app.get("/moderation", (c) => c.redirect("/", 302));

// Polled by the author's browser while their post is pending.
// A pending post's page waits here for its decision (a long poll), so it updates as soon as
// CalmLens decides. After DECISION_WAIT_MS without one it answers `pending` and the page asks
// again. Webhooks would update the post too; this is what keeps the open page live.
const DECISION_WAIT_MS = 25_000;
/** Decisions that keep a post from other users. Age-restricted posts are published. */
const NOT_SHOWN = new Set<ModerationStatus>(["blocked", "purged"]);

app.get("/api/posts/:id/status", async (c) => {
  const sandbox = await currentSandbox(c);
  const post = sandbox?.posts.find((p) => p.id === c.req.param("id"));
  if (!sandbox || !post) return c.json({ error: "Not found" }, 404);
  let decided: ModerationFields = post;
  if (post.status === "pending") {
    const outcome = await getModeration(c.env).waitForDecision(post.assetId, {
      timeoutMs: DECISION_WAIT_MS,
      signal: c.req.raw.signal,
    });
    if (outcome.status !== "pending") {
      decided = (await syncAsset(c.env, post.assetId, outcome)) ?? post;
    }
  }
  return c.json({
    status: decided.status,
    reason: NOT_SHOWN.has(decided.status) ? describeFindings(decided.findings) : null,
  });
});

// Configure in CalmLens: Portal → Webhooks → https://<your-app>/api/webhooks/calmlens
// Subscribe to asset.allowed, asset.limited, asset.age-restricted, asset.blocked, asset.purged and
// asset.failed.
// There is one event per moderation status, from automated moderation or a reviewer in the
// portal; the decided-by fact says which.
app.post("/api/webhooks/calmlens", async (c) => {
  // Verify the exact raw body. Parsing and re-serialising JSON would change the signature.
  const rawBody = await c.req.text();
  const signature = c.req.header("x-calmlens-signature") ?? "";
  const timestamp = c.req.header("x-calmlens-timestamp") ?? "";
  if (!(await getModeration(c.env).verifyWebhook(rawBody, signature, timestamp))) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let delivery: ReturnType<typeof readWebhookDelivery>;
  try {
    delivery = readWebhookDelivery(rawBody);
  } catch {
    return c.json({ error: "Invalid delivery" }, 400);
  }

  // CalmLens retries failed deliveries, so make the handler idempotent by event ID.
  const eventKey = `event:${delivery.eventId}`;
  if (await c.env.CALMGRAM.get(eventKey)) return c.json({ ok: true, duplicate: true });

  if (delivery.syncAssetId) {
    // Fetch the asset for its current status and report rather than trusting the snapshot.
    await syncAsset(c.env, delivery.syncAssetId);
  }
  await c.env.CALMGRAM.put(eventKey, "1", { expirationTtl: 2 * 24 * 60 * 60 });
  return c.json({ ok: true });
});

// Demo mode's stand-in for the CalmLens CDN. With CalmLens configured, images are served
// from cdn.calmlens.com and this route is unused.
app.get("/demo-media/:assetId", async (c) => {
  const upload = await readDemoUpload(c.env.CALMGRAM, c.req.param("assetId"), {
    ageConfirmed: c.req.query("ageConfirmed") === "true",
  });
  if (!upload) return c.text("Not available", 403);
  return c.body(upload.bytes, 200, {
    "Content-Type": upload.mimeType,
    "Cache-Control": "private, max-age=3600",
  });
});

// Demo mode's stand-in for the CDN's `/placeholder` resource: a small blurred PNG.
app.get("/demo-media/:assetId/placeholder", async (c) => {
  const placeholder = await readDemoPlaceholder(c.env.CALMGRAM, c.req.param("assetId"));
  if (!placeholder) return c.text("Not available", 403);
  return c.body(new Uint8Array(placeholder).buffer, 200, {
    "Content-Type": "image/png",
    "Cache-Control": "private, max-age=3600",
  });
});

app.notFound((c) => c.text("Not found", 404));

app.onError((error, c) => {
  console.error(
    "[calmgram]",
    error instanceof CalmLensError ? describeCalmLensError(error) : error,
  );
  return c.text("Something went wrong. Please try again.", 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env) {
    const deleted = await deleteExpiredSandboxes(env, getModeration(env));
    if (deleted) console.debug(`[calmgram] deleted ${deleted} expired sandboxes`);
  },
} satisfies ExportedHandler<Env>;
