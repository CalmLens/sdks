import { spendModerationBudget } from "./budget";
import {
  applyOutcome,
  type Comment,
  type Env,
  newId,
  type Post,
  type Sandbox,
  type UploadDraft,
} from "./data";
import { exampleFeedFor } from "./examples";
import { getModeration } from "./moderation";
import { describeFindings, type ModerationOutcome } from "./moderation/types";
import { rememberAsset, sandboxForAsset, saveSandbox } from "./sandbox";

// All of Calmgram's moderation logic lives here. The pattern:
//   text (captions, comments, bios) → classify synchronously, refuse to save unless allowed
//   images                         → upload, mark pending, resolve via webhook or polling
// With an upload preset, the browser uploads the photo straight to CalmLens with a token this
// server signed, then submits the asset ID. Without JavaScript (or a preset), it posts the photo
// here and the server forwards it. Either way, only a CalmLens decision publishes a post.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // CalmLens direct-upload limit
// A public demo uses one CalmLens project for everyone, so cap uploads per sandbox.
export const MAX_POSTS_PER_SANDBOX = 20;
const RECHECK_AFTER_MS = 2000;
// Upload tokens can start an upload for 10 minutes; leave time to finish it and submit the form.
const UPLOAD_DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_UPLOAD_DRAFTS = 5;

/** The submitted asset isn't the photo this visitor was given an upload token for. */
export class UnknownUpload extends Error {
  constructor() {
    super("That upload doesn't belong to this post");
  }
}

export class ModerationRejection extends Error {
  constructor(what: string, reason: string, verb = "posted") {
    super(`Your ${what} wasn't ${verb} because it may contain ${reason}.`);
  }
}

/** The externalId each item's CalmLens asset was created with. */
export const externalIdFor = (item: Post | Comment) =>
  "postId" in item ? `comment-${item.id}` : `post-${item.id}`;

/**
 * Applies a decision only if it is for this item's asset: the asset IDs must match and, when
 * the provider reports one, so must the externalId we created the asset with.
 */
export const applyOutcomeTo = (item: Post | Comment, outcome: ModerationOutcome) => {
  if (
    outcome.assetId !== item.assetId ||
    (outcome.externalId !== undefined && outcome.externalId !== externalIdFor(item))
  ) {
    console.warn("[calmgram] ignoring a decision for another record", {
      itemId: item.id,
      assetId: outcome.assetId,
    });
    return false;
  }
  applyOutcome(item, outcome);
  return true;
};

/** Counts CalmLens calls against the daily budget; demo mode costs nothing. */
const spend = (env: Env, calls = 1) =>
  getModeration(env).mode === "calmlens" ? spendModerationBudget(env, calls) : undefined;

/** Everything a visitor can see: their own sandbox plus the shared starter feed. */
export const loadFeed = async (env: Env, sandbox: Sandbox | null) => {
  const examples = exampleFeedFor(sandbox?.createdAt ?? Date.now());
  const posts = [...(sandbox?.posts ?? []), ...examples].sort((a, b) => b.createdAt - a.createdAt);
  const comments = sandbox?.comments ?? [];
  const likesFor = (postId: string) => sandbox?.likes[postId] ?? [];
  const bioFor = (username: string) => (username === sandbox?.username ? sandbox.bio : "");
  return { posts, comments, likesFor, bioFor };
};

/** Checks a caption before anything is saved; throws `ModerationRejection` unless it's allowed. */
const checkCaption = async (env: Env, sandbox: Sandbox, postId: string, caption: string) => {
  if (!caption.trim()) return;
  const outcome = await getModeration(env).moderateText({
    text: caption,
    kind: "caption",
    externalId: `caption-${postId}`,
    username: sandbox.username,
  });
  if (outcome.status !== "allowed") {
    throw new ModerationRejection("post", describeFindings(outcome.findings));
  }
};

/** Saves a post whose photo CalmLens is checking. It stays visible only to its author until allowed. */
const savePost = async (
  env: Env,
  sandbox: Sandbox,
  id: string,
  caption: string,
  image: ModerationOutcome,
) => {
  const post: Post = {
    id,
    author: sandbox.username,
    caption: caption.trim(),
    createdAt: Date.now(),
    assetId: image.assetId,
    status: image.status,
    findings: image.findings,
    checkedAt: Date.now(),
  };
  sandbox.posts.unshift(post);
  await Promise.all([saveSandbox(env, sandbox), rememberAsset(env, post.assetId, sandbox.id)]);
  return post;
};

/** The no-JavaScript fallback: the browser posted the photo here, so forward it to CalmLens. */
export const createPost = async (
  env: Env,
  sandbox: Sandbox,
  input: { caption: string; image: File },
) => {
  const id = newId();
  await spend(env, input.caption.trim() ? 2 : 1);
  // 1. Check the caption first — it's fast, and if it fails we skip the image upload.
  await checkCaption(env, sandbox, id, input.caption);
  // 2. Queue the image. It stays "pending" (visible only to its author) until allowed.
  const image = await getModeration(env).submitImage({
    file: input.image,
    externalId: `post-${id}`,
    username: sandbox.username,
  });
  return savePost(env, sandbox, id, input.caption, image);
};

/**
 * Step 1 of a browser upload: reserve a post ID and sign a single-use upload token for it. The
 * token gives the asset the externalId `post-<id>`, which is how step 2 knows the upload is ours.
 */
export const startUpload = async (env: Env, sandbox: Sandbox) => {
  await spend(env);
  const postId = newId();
  const { token, expiresAt } = await getModeration(env).signUploadToken({
    externalId: `post-${postId}`,
  });
  const now = Date.now();
  const drafts = (sandbox.uploads ?? []).filter(
    (draft) => now - draft.startedAt < UPLOAD_DRAFT_TTL_MS,
  );
  sandbox.uploads = [...drafts, { postId, startedAt: now }].slice(-MAX_UPLOAD_DRAFTS);
  await saveSandbox(env, sandbox);
  return { postId, token, expiresAt };
};

/** Removes and returns the visitor's unexpired upload draft for `postId`, if there is one. */
export const takeUploadDraft = (sandbox: Sandbox, postId: string, now = Date.now()) => {
  const draft = sandbox.uploads?.find((upload) => upload.postId === postId);
  sandbox.uploads = sandbox.uploads?.filter((upload) => upload.postId !== postId);
  return draft && now - draft.startedAt < UPLOAD_DRAFT_TTL_MS ? draft : null;
};

/**
 * Whether an asset is the photo uploaded with the token signed for `draft`: CalmLens set its
 * externalId from that token, and it came through this app's upload preset.
 */
export const isUploadFor = (
  image: ModerationOutcome,
  draft: UploadDraft,
  uploadPresetId: string | null,
) =>
  uploadPresetId !== null &&
  image.externalId === `post-${draft.postId}` &&
  image.uploadPresetId === uploadPresetId;

/**
 * Step 2 of a browser upload: the browser sends the asset ID with the caption. Its word is only
 * a pointer: the asset is fetched from CalmLens and must match the token we signed, and the post
 * is published only when CalmLens allows it (webhook or polling), like any other.
 */
export const attachUpload = async (
  env: Env,
  sandbox: Sandbox,
  input: { postId: string; assetId: string; caption: string },
) => {
  const moderation = getModeration(env);
  const draft = takeUploadDraft(sandbox, input.postId);
  if (!draft) throw new UnknownUpload();
  const image = await moderation.checkAsset(input.assetId);
  if (!isUploadFor(image, draft, moderation.uploadPresetId)) throw new UnknownUpload();
  if (input.caption.trim()) await spend(env);
  try {
    await checkCaption(env, sandbox, draft.postId, input.caption);
  } catch (error) {
    // The photo is already on CalmLens; don't leave it behind for a post that won't exist.
    await moderation.deleteAsset(image.assetId);
    await saveSandbox(env, sandbox);
    throw error;
  }
  return savePost(env, sandbox, draft.postId, input.caption, image);
};

/**
 * Polling fallback for missed webhooks: any page that shows a pending post re-checks it here
 * (rate-limited by `checkedAt`).
 */
export const refreshPending = async (env: Env, sandbox: Sandbox | null, posts: Post[]) => {
  const stale = posts.filter(
    (post) =>
      !post.exampleId &&
      post.status === "pending" &&
      Date.now() - post.checkedAt > RECHECK_AFTER_MS,
  );
  if (stale.length === 0) return posts;
  const moderation = getModeration(env);
  const outcomes = await Promise.all(
    stale.map((post) => moderation.checkAsset(post.assetId).catch(() => null)),
  );
  const fresh = new Map<string, Post>();
  stale.forEach((post, index) => {
    const updated = { ...post };
    const outcome = outcomes[index];
    if (!outcome || !applyOutcomeTo(updated, outcome)) updated.checkedAt = Date.now();
    fresh.set(post.id, updated);
  });
  if (sandbox) {
    sandbox.posts = sandbox.posts.map((post) => fresh.get(post.id) ?? post);
    await saveSandbox(env, sandbox);
  }
  return posts.map((post) => fresh.get(post.id) ?? post);
};

/**
 * Called from the webhook handler with an asset ID from a decision event such as `asset.allowed`
 * or `asset.blocked`, and with the `outcome` once a waiting browser's post is decided.
 */
export const syncAsset = async (env: Env, assetId: string, outcome?: ModerationOutcome) => {
  const sandbox = await sandboxForAsset(env, assetId);
  if (!sandbox) return null;
  const item =
    sandbox.posts.find((post) => post.assetId === assetId) ??
    sandbox.comments.find((comment) => comment.assetId === assetId);
  if (!item) return null;
  if (!applyOutcomeTo(item, outcome ?? (await getModeration(env).checkAsset(assetId)))) return null;
  await saveSandbox(env, sandbox);
  return item;
};

export const addComment = async (
  env: Env,
  sandbox: Sandbox,
  input: { postId: string; text: string },
) => {
  const id = newId();
  await spend(env);
  const outcome = await getModeration(env).moderateText({
    text: input.text,
    kind: "comment",
    externalId: `comment-${id}`,
    username: sandbox.username,
  });
  const comment: Comment = {
    id,
    postId: input.postId,
    author: sandbox.username,
    text: input.text.trim(),
    createdAt: Date.now(),
    assetId: outcome.assetId,
    status: outcome.status,
    findings: outcome.findings,
    checkedAt: Date.now(),
  };
  // Comments that aren't allowed are stored too (but never shown) so moderators can see them.
  sandbox.comments.push(comment);
  await saveSandbox(env, sandbox);
  if (outcome.status !== "allowed") {
    throw new ModerationRejection("comment", describeFindings(outcome.findings));
  }
  return comment;
};

export const updateBio = async (env: Env, sandbox: Sandbox, bio: string) => {
  if (bio.trim()) {
    await spend(env);
    const outcome = await getModeration(env).moderateText({
      text: bio,
      kind: "bio",
      externalId: `bio-${sandbox.id}-${Date.now()}`,
      username: sandbox.username,
    });
    if (outcome.status !== "allowed") {
      throw new ModerationRejection("bio", describeFindings(outcome.findings), "saved");
    }
  }
  sandbox.bio = bio.trim();
  await saveSandbox(env, sandbox);
};

/** Only the visitor's own posts can be deleted; the starter feed is shared. */
export const deletePost = async (env: Env, sandbox: Sandbox, postId: string) => {
  const post = sandbox.posts.find((p) => p.id === postId);
  if (!post) return;
  // Delete the image from CalmLens too — it's the only copy, and users expect it gone.
  await getModeration(env).deleteAsset(post.assetId);
  sandbox.posts = sandbox.posts.filter((p) => p.id !== postId);
  sandbox.comments = sandbox.comments.filter((c) => c.postId !== postId);
  delete sandbox.likes[postId];
  await saveSandbox(env, sandbox);
};

export const deleteComment = async (env: Env, sandbox: Sandbox, commentId: string) => {
  sandbox.comments = sandbox.comments.filter((c) => c.id !== commentId);
  await saveSandbox(env, sandbox);
};

export const toggleLike = async (env: Env, sandbox: Sandbox, postId: string) => {
  const likes = new Set(sandbox.likes[postId] ?? []);
  if (likes.has(sandbox.username)) likes.delete(sandbox.username);
  else likes.add(sandbox.username);
  sandbox.likes[postId] = [...likes];
  await saveSandbox(env, sandbox);
};

/** Who is looking at a page, or null when signed out (no sandbox, such as a crawler). */
export interface Viewer {
  username: string;
  /** The "Show sensitive media" setting: the app's stand-in for a real age check. */
  showSensitiveMedia: boolean;
}

export const viewerOf = (sandbox: Sandbox | null): Viewer | null =>
  sandbox ? { username: sandbox.username, showSensitiveMedia: !!sandbox.showSensitiveMedia } : null;

/** Published posts: shown to everyone, age-restricted ones behind a placeholder. */
export const isPublished = (post: Post) =>
  post.status === "allowed" || post.status === "age-restricted";

/** Published posts for everyone; the viewer also sees their own posts that aren't published. */
export const isVisibleTo = (post: Post, viewer: string | null) =>
  isPublished(post) || post.author === viewer;

/** What a post's photo slot shows: the photo, or a blurred placeholder in its place. */
export interface PostMedia {
  /** The photo's URL, or null when it isn't shown to this viewer. */
  url: string | null;
  /** For age-restricted photos this viewer may not see: the blurred placeholder's URL. */
  placeholderUrl: string | null;
}

/**
 * Never builds a content URL for anything that isn't published. Age-restricted photos get the
 * `allowAgeRestricted=true` opt-in only for viewers who turned on "Show sensitive media" (authors
 * included); signed-out viewers and everyone else get the placeholder.
 */
export const postMediaFor = (
  env: Env,
  post: Post,
  variant: "feed" | "thumb",
  viewer: Viewer | null,
): PostMedia => {
  if (post.exampleId) return { url: null, placeholderUrl: null };
  const moderation = getModeration(env);
  if (post.status === "allowed") {
    return { url: moderation.imageUrl(post.assetId, variant), placeholderUrl: null };
  }
  if (post.status === "age-restricted") {
    return viewer?.showSensitiveMedia
      ? {
          url: moderation.imageUrl(post.assetId, variant, { allowAgeRestricted: true }),
          placeholderUrl: null,
        }
      : { url: null, placeholderUrl: moderation.placeholderUrl(post.assetId) };
  }
  return { url: null, placeholderUrl: null };
};
