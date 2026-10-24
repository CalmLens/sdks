import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { CalmLensIcon } from "./CalmLensIcons";
import type { Comment, Flash, ModerationFields, Post } from "./data";
import { examplePostArtworkUrl } from "./example-artwork";
import { EXAMPLE_POSTS_BY_ID } from "./examples";
import {
  CATEGORY_LABELS,
  describeFindings,
  isShownToEveryone,
  type ModerationStatus,
} from "./moderation/types";

// Server-rendered HTML. Every action is a plain form post that redirects back, so the only
// JavaScript is a confirmation dialog before deletes (browser/confirm.ts), an image preview, and
// polling while a photo is checked.

export const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-fg",
  secondary: "bg-subtle text-fg",
  danger: "border border-line bg-transparent text-danger",
  destructive: "bg-danger text-white",
};

export const buttonClass = (variant: keyof typeof BUTTON_VARIANTS = "primary", size?: "small") =>
  cx(
    "inline-flex cursor-pointer items-center justify-center rounded-lg text-sm font-semibold hover:no-underline hover:brightness-105 disabled:cursor-default disabled:opacity-50",
    size === "small" ? "px-3 py-[5px]" : "px-4 py-2",
    BUTTON_VARIANTS[variant],
  );

export const iconButtonClass =
  "inline-flex cursor-pointer items-center justify-center rounded-lg p-1 hover:bg-subtle hover:no-underline";

/** Panels that span the full width on phones lose their rounded corners and side borders. */
export const panelClass =
  "rounded-xl border border-line bg-surface max-sm:rounded-none max-sm:border-x-0";

export const timeAgo = (timestamp: number) => {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

const icon = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

export const HeartIcon = ({ filled }: { filled?: boolean }) => (
  <svg {...icon} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.4 3.5 4.1 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" />
  </svg>
);
const CommentIcon = () => (
  <svg {...icon}>
    <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z" />
  </svg>
);
const HomeIcon = () => (
  <svg {...icon}>
    <path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5Z" />
  </svg>
);
const PlusIcon = () => (
  <svg {...icon}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const ClockIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
const BlockedIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </svg>
);

const HUES = [12, 38, 160, 200, 262, 320];

export const Avatar = ({
  username,
  size = 32,
  class: className,
}: {
  username: string;
  size?: number;
  class?: string;
}) => {
  const hue = HUES[[...username].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];
  return (
    <span
      class={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        className,
      )}
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        "font-size": `${size * 0.42}px`,
        background: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${hue + 40} 75% 52%))`,
      }}
    >
      {username[0]?.toUpperCase()}
    </span>
  );
};

/** What the confirmation dialog asks before a destructive post. */
export type Confirmation = { title: string; description?: string; action: string };

/**
 * A button that posts to `action`. With `confirm`, browser/confirm.ts asks first in a dialog;
 * without JavaScript the form posts straight away.
 */
export const PostButton = (props: {
  action: string;
  confirm?: Confirmation;
  class?: string;
  label?: string;
  children: Child;
}) => (
  <form
    method="post"
    action={props.action}
    class="m-0 inline-flex items-center"
    data-confirm-title={props.confirm?.title}
    data-confirm-description={props.confirm?.description}
    data-confirm-action={props.confirm?.action}
  >
    <button type="submit" class={props.class ?? buttonClass("danger")} aria-label={props.label}>
      {props.children}
    </button>
  </form>
);

/**
 * The dialog browser/confirm.ts opens before a PostButton with `confirm` posts. It fills in the
 * text, and the inner form closes the dialog with the button's value as its return value.
 */
const ConfirmDialog = () => (
  <dialog
    id="confirm-dialog"
    aria-labelledby="confirm-title"
    aria-describedby="confirm-description"
    class="m-auto w-[calc(100%-32px)] max-w-[400px] rounded-xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/50"
  >
    <form method="dialog" class="p-6">
      <h2 id="confirm-title" class="m-0 text-base font-bold">
        Are you sure?
      </h2>
      <p id="confirm-description" class="mt-2 mb-0 text-muted" />
      <div class="mt-6 flex justify-end gap-2.5">
        <button type="submit" value="cancel" class={buttonClass("secondary")} autofocus>
          Cancel
        </button>
        <button
          type="submit"
          value="confirm"
          id="confirm-action"
          class={buttonClass("destructive")}
        >
          Confirm
        </button>
      </div>
    </form>
  </dialog>
);

export const FormError = (props: { class?: string; children: Child }) => (
  <p class={cx("mt-1.5 mb-0 text-danger", props.class)} role="alert">
    {props.children}
  </p>
);

export const FlashMessage = ({
  flash,
  class: className,
}: {
  flash: Flash | null;
  class?: string;
}) =>
  flash?.error ? (
    <FormError class={className}>{flash.error}</FormError>
  ) : flash?.notice ? (
    <p class={cx("text-muted", className)} role="status">
      {flash.notice}
    </p>
  ) : null;

// While the author's post is being checked, poll its status and reload when it changes.
// Waits on the server for the post's decision and reloads once it arrives. Each request is a
// long poll that answers `pending` after a while, so the loop asks again; failures back off.
const pendingPoller = (postId: string) =>
  raw(`<script>(async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(${JSON.stringify(`/api/posts/${postId}/status`)}, { cache: "no-store" });
      if (response.ok) {
        const { status } = await response.json();
        if (status !== "pending") return location.reload();
        continue;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
})();</script>`);

/** Where the "Show sensitive media" setting lives, for a signed-in viewer. */
export const sensitiveMediaSettingHref = (username: string) => `/u/${username}#sensitive-media`;

/**
 * An age-restricted photo for a viewer who hasn't turned on "Show sensitive media": its blurred
 * placeholder with a notice. Signed-out viewers get no link, since they have no settings.
 */
const SensitivePlaceholder = (props: {
  post: Post;
  variant: "feed" | "thumb";
  placeholderUrl: string;
  settingsHref: string | null;
}) => (
  <figure
    class="relative m-0 aspect-square w-full overflow-hidden bg-subtle"
    aria-label="Sensitive content"
  >
    <img
      src={props.placeholderUrl}
      alt=""
      class="absolute inset-0 size-full scale-110 object-cover blur-md"
    />
    <figcaption
      class={cx(
        "absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 text-center text-white",
        props.variant === "thumb" ? "p-2 text-xs" : "p-6",
      )}
    >
      <strong>Sensitive content</strong>
      {props.variant === "feed" && (
        <>
          <span>This photo may contain {describeFindings(props.post.findings)}.</span>
          {props.settingsHref && (
            <a href={props.settingsHref} class="font-semibold text-white underline">
              Show sensitive media
            </a>
          )}
        </>
      )}
    </figcaption>
  </figure>
);

export const PostImage = ({
  post,
  variant,
  url,
  placeholderUrl = null,
  settingsHref = null,
}: {
  post: Post;
  variant: "feed" | "thumb";
  url: string | null;
  /** Set for an age-restricted photo this viewer may not see. */
  placeholderUrl?: string | null;
  /** The viewer's "Show sensitive media" setting, or null when signed out. */
  settingsHref?: string | null;
}) => {
  if (post.exampleId) {
    const example = EXAMPLE_POSTS_BY_ID.get(post.exampleId);
    const blocked = post.status !== "allowed";
    if (variant === "feed" && !example?.media && !blocked) return null;
    if (!blocked && example?.media)
      return (
        <img
          src={examplePostArtworkUrl(example.media)}
          alt={example.label}
          width={600}
          height={320}
          loading="lazy"
          class={
            variant === "thumb" ? "block aspect-square w-full object-cover" : "block h-auto w-full"
          }
        />
      );
    return (
      <div
        class={cx(
          "flex flex-col items-center justify-center gap-2 bg-subtle p-4 text-center text-muted",
          variant === "thumb" ? "aspect-square" : "min-h-40",
        )}
      >
        <span aria-hidden="true" class="text-4xl">
          {blocked ? "◌" : "≡"}
        </span>
        <span>{blocked ? "Content blocked" : example?.label}</span>
        <small>Illustrative example</small>
      </div>
    );
  }
  if (placeholderUrl) {
    return (
      <SensitivePlaceholder
        post={post}
        variant={variant}
        placeholderUrl={placeholderUrl}
        settingsHref={settingsHref}
      />
    );
  }
  if (url) {
    return (
      <img
        src={url}
        alt={post.caption || `Photo by ${post.author}`}
        class="block aspect-square w-full object-cover"
        loading="lazy"
      />
    );
  }
  const placeholder = cx(
    "flex aspect-square w-full flex-col items-center justify-center gap-1.5 text-center text-muted [&_strong]:text-fg [&_svg]:size-9",
    variant === "thumb" ? "p-2" : "p-6",
  );
  if (post.status === "pending") {
    return (
      <div class={cx(placeholder, "[&_svg]:animate-pulse motion-reduce:[&_svg]:animate-none")}>
        <ClockIcon />
        {variant === "feed" && (
          <>
            <strong>Checking your photo…</strong>
            <span>Only you can see this post until CalmLens allows it.</span>
          </>
        )}
        {!post.exampleId && pendingPoller(post.id)}
      </div>
    );
  }
  return (
    <div class={cx(placeholder, "bg-danger-soft [&_svg]:text-danger")}>
      <BlockedIcon />
      {variant === "feed" && (
        <>
          <strong>
            {post.status === "error"
              ? "We couldn't check this photo"
              : "This photo wasn't published"}
          </strong>
          <span>
            {post.status === "error"
              ? "Please try uploading it again."
              : `It may contain ${describeFindings(post.findings)}. Only you can see this notice.`}
          </span>
        </>
      )}
    </div>
  );
};

export const PostCard = (props: {
  post: Post;
  imageUrl: string | null;
  /** Set for an age-restricted photo this viewer may not see. */
  placeholderUrl?: string | null;
  comments: Comment[];
  likes: string[];
  viewer: string | null;
  linkToPost?: boolean;
}) => {
  const { post, comments, likes, viewer, linkToPost = true } = props;
  const visibleComments = comments.filter((c) => isShownToEveryone(c.status));
  const liked = !!viewer && likes.includes(viewer);
  const published = isShownToEveryone(post.status) || post.status === "age-restricted";
  const image = (
    <PostImage
      post={post}
      variant="feed"
      url={props.imageUrl}
      placeholderUrl={props.placeholderUrl}
      settingsHref={viewer ? sensitiveMediaSettingHref(viewer) : null}
    />
  );
  return (
    <article class={cx(panelClass, "overflow-hidden")}>
      <header class="flex items-center gap-2 px-3 py-2.5">
        <a href={`/u/${post.author}`} class="flex items-center gap-2 font-semibold">
          <Avatar username={post.author} />
          <span>{post.author}</span>
        </a>
        <span class="text-muted">· {timeAgo(post.createdAt)}</span>
        {post.exampleId && <span class="text-xs text-muted">Example</span>}
      </header>

      {linkToPost &&
      published &&
      !props.placeholderUrl &&
      (!post.exampleId || EXAMPLE_POSTS_BY_ID.get(post.exampleId)?.media) ? (
        <a href={`/p/${post.id}`} class="block bg-subtle">
          {image}
        </a>
      ) : (
        <div class="block bg-subtle">{image}</div>
      )}

      {published && (
        <div class="px-3 pt-1.5 pb-3">
          {post.status === "age-restricted" && post.author === viewer && !post.exampleId && (
            <p class="text-warn" role="status">
              Age-restricted: shown only to people who turned on sensitive media. Everyone else sees
              a blurred placeholder.
            </p>
          )}
          <div class="-ml-1 flex items-center gap-1">
            <div class="flex items-center gap-1">
              <PostButton
                action={`/p/${post.id}/like`}
                class={cx(iconButtonClass, liked && "text-danger")}
                label={liked ? "Unlike" : "Like"}
              >
                <HeartIcon filled={liked} />
              </PostButton>
              <span class="mr-2 font-semibold">
                {likes.length === 1 ? "1 like" : `${likes.length} likes`}
              </span>
            </div>
            <a href={`/p/${post.id}#comments`} class={iconButtonClass} aria-label="Comments">
              <CommentIcon />
            </a>
          </div>
          {post.caption && (
            <p>
              <a href={`/u/${post.author}`} class="font-semibold">
                {post.author}
              </a>{" "}
              {post.caption}
            </p>
          )}
          {linkToPost && visibleComments.length > 0 && (
            <a href={`/p/${post.id}#comments`} class="text-muted">
              View{" "}
              {visibleComments.length === 1
                ? "1 comment"
                : `all ${visibleComments.length} comments`}
            </a>
          )}
        </div>
      )}
    </article>
  );
};

export const Findings = ({ item }: { item: ModerationFields }) => {
  const top = item.findings.filter((f) => f.score >= 0.05).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <ul class="my-2 grid max-w-[360px] gap-1">
      {top.map((finding) => (
        <li class="grid grid-cols-[120px_1fr_40px] items-center gap-2 text-xs">
          <span>{CATEGORY_LABELS[finding.category] ?? finding.category}</span>
          <span class="h-1.5 overflow-hidden rounded-[3px] bg-subtle" aria-hidden="true">
            <span
              class="block h-full bg-danger"
              style={{ width: `${Math.round(finding.score * 100)}%` }}
            />
          </span>
          <span class="text-right text-muted tabular-nums">{Math.round(finding.score * 100)}%</span>
        </li>
      ))}
    </ul>
  );
};

/** Compact score readout matching the landing page's decision feed, using real findings. */
export const QueueScores = ({ item }: { item: ModerationFields }) => (
  <span class="queue-scores">
    {item.findings.map((finding) => (
      <span
        class="queue-score"
        title={`${CATEGORY_LABELS[finding.category] ?? finding.category}: ${Math.round(finding.score * 100)}%`}
      >
        <svg
          viewBox="0 0 36 36"
          role="img"
          aria-label={`${CATEGORY_LABELS[finding.category] ?? finding.category}: ${Math.round(finding.score * 100)}%`}
        >
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--cl-track)" stroke-width="3" />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            stroke={finding.score >= 0.7 ? "#ef4444" : finding.score >= 0.4 ? "#eab308" : "#22c55e"}
            stroke-width="3"
            pathLength="100"
            stroke-dasharray={`${finding.score * 100} 100`}
            stroke-linecap="round"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span class="queue-score-icon">
          <CalmLensIcon name={finding.category} />
        </span>
      </span>
    ))}
  </span>
);

export const QueueTypeIcon = ({ kind }: { kind: "post" | "comment" }) => (
  <span class="queue-type" aria-hidden="true">
    <CalmLensIcon name={kind} />
  </span>
);

export const Decision = ({ item }: { item: ModerationFields }) => {
  const status = item.status;
  const labels: Record<ModerationStatus, string> = {
    allowed: "Allowed",
    limited: "Limited",
    "age-restricted": "Age-restricted",
    blocked: "Blocked",
    purged: "Purged",
    pending: "Pending",
    error: "Failed",
  };
  return (
    <span class={`queue-status queue-status-${status}`}>
      <CalmLensIcon name={status} />
      {labels[status]}
    </span>
  );
};

/** The CalmLens emblem, drawn in the current text colour. */
const CalmLensEmblem = () => (
  <svg viewBox="0 0 100 100" width="26" height="26" fill="currentColor" aria-hidden="true">
    <path d="M12 48a38 38 0 0 1 76 0H76a26 26 0 0 0-52 0H12Z" />
    <circle cx="50" cy="38" r="8" />
    <path
      d="M10 56h80C87 78 70 92 50 92S13 78 10 56Zm15 11c5 9 14 14 25 14s20-5 25-14H25Z"
      fill-rule="evenodd"
    />
  </svg>
);

/**
 * CalmLens's side of the demo, drawn over Calmgram: the review tools an app owner gets from
 * CalmLens, kept visibly apart from the app their users see.
 */
export const CalmLensOverlay = (props: { title: string; children: Child }) => (
  <div class="calmlens fixed right-4 bottom-4 z-50 w-[calc(100%-32px)] max-w-[460px] max-sm:right-2 max-sm:bottom-2 max-sm:w-[calc(100%-16px)]">
    <details
      open
      aria-labelledby="calmlens-overlay-title"
      class="overflow-hidden rounded-xl border border-line bg-cl-page text-fg shadow-2xl"
    >
      <summary class="flex cursor-pointer list-none items-center gap-3 bg-surface px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span class="text-fg">
          <CalmLensEmblem />
        </span>
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[15px] font-semibold">CalmLens</p>
          <h1 id="calmlens-overlay-title" class="m-0 text-[13px] font-normal text-muted">
            {props.title}
          </h1>
        </div>
        <span class="queue-toggle" aria-hidden="true">
          <CalmLensIcon name="toggle" />
        </span>
      </summary>
      <div class="max-h-[calc(80dvh-80px)] overflow-y-auto overscroll-contain border-t border-line px-5 py-4">
        {props.children}
      </div>
    </details>
  </div>
);

export const logoClass = "font-logo text-[28px] font-semibold tracking-[0.5px] hover:no-underline";

export const Layout = (props: {
  title?: string;
  username: string | null;
  demo: boolean;
  /** Floating review panel; the feed remains interactive underneath. */
  overlay?: Child;
  children: Child;
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title ? `${props.title} · Calmgram` : "Calmgram"}</title>
      <meta name="description" content="An Instagram-style example app moderated by CalmLens." />
      <link rel="stylesheet" href="/styles.css" />
      <script type="module" src="/confirm.js" />
    </head>
    <body>
      <div>
        {props.demo ? (
          <div class="bg-banner px-4 py-2 text-center text-[13px] text-banner-fg">
            <strong>Demo mode:</strong> moderation is simulated locally. Add your CalmLens API key
            and project ID to <code>.dev.vars</code> for real moderation.
          </div>
        ) : (
          <div class="bg-banner px-4 py-2 text-center text-[13px] text-banner-fg">
            <strong>Your private sandbox:</strong> only you see what you post here, and it's deleted
            24 hours after your last visit. Every photo, caption, comment and bio is checked by{" "}
            <a href="https://calmlens.com">CalmLens</a>.
          </div>
        )}
        <header class="sticky top-0 z-10 border-b border-line bg-surface">
          <div class="mx-auto flex max-w-[935px] items-center justify-between gap-3 px-4 py-2.5">
            <a href="/" class={logoClass}>
              Calmgram
            </a>
            <nav class="flex items-center gap-3.5 max-sm:gap-2">
              <a href="/" aria-label="Home" class={iconButtonClass}>
                <HomeIcon />
              </a>
              <a href="/new" aria-label="New post" class={iconButtonClass}>
                <PlusIcon />
              </a>
              {props.username ? (
                <>
                  <a href={`/u/${props.username}`} aria-label="Your profile">
                    <Avatar username={props.username} size={26} />
                  </a>
                  <PostButton
                    action="/start-over"
                    class="cursor-pointer whitespace-nowrap text-muted hover:text-fg"
                    confirm={{
                      title: "Start over?",
                      description:
                        "You'll get a new username, and everything you've posted here will be lost.",
                      action: "Start over",
                    }}
                  >
                    Start over
                  </PostButton>
                </>
              ) : null}
            </nav>
          </div>
        </header>
        <main class="mx-auto max-w-[935px] px-4 pt-6 pb-12 max-sm:px-0 max-sm:pt-3 max-sm:pb-10">
          {props.children}
        </main>
        <footer class="px-4 pb-8 text-center text-xs text-muted [&_a]:underline">
          Calmgram is an example app. Photos, captions, comments and bios are moderated by{" "}
          <a href="https://calmlens.com">CalmLens</a>.
        </footer>
      </div>
      {props.overlay}
      <ConfirmDialog />
    </body>
  </html>
);

/** A failed submission keeps its draft; incoming links only prefill a new draft. */
export const PostCaption = ({ draft, prefill }: { draft?: string; prefill?: string }) => (
  <textarea
    name="caption"
    placeholder="Write a caption…"
    maxlength={2200}
    rows={3}
    aria-label="Caption"
  >
    {(draft ?? prefill ?? "").slice(0, 2200)}
  </textarea>
);
