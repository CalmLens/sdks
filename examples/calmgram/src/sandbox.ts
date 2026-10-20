import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env, Flash, Sandbox } from "./data";
import { EXAMPLE_AUTHORS } from "./examples";
import type { ModerationProvider } from "./moderation/types";

// Each visitor's sandbox is deleted 24 hours after they last used it, along with their images
// on CalmLens. The hourly cron does the deleting; the KV TTL is a backstop in case it can't.
export const SANDBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const KV_TTL_SECONDS = 2 * 24 * 60 * 60;
// Viewing pages counts as use, but only rewrite the sandbox this often just to record that.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const COOKIE = "calmgram_session";
const sandboxKey = (id: string) => `sandbox:${id}`;
const assetKey = (assetId: string) => `asset:${assetId}`;

type AppContext = Context<{ Bindings: Env }>;

export const loadSandbox = async (env: Env, id: string) =>
  env.CALMGRAM.get<Sandbox>(sandboxKey(id), "json");

export const saveSandbox = async (env: Env, sandbox: Sandbox) => {
  sandbox.lastActiveAt = Date.now();
  await env.CALMGRAM.put(sandboxKey(sandbox.id), JSON.stringify(sandbox), {
    expirationTtl: KV_TTL_SECONDS,
    metadata: { lastActiveAt: sandbox.lastActiveAt },
  });
};

/** The visitor's sandbox, or null if they haven't picked a username yet (or it expired). */
export const currentSandbox = async (c: AppContext) => {
  const id = getCookie(c, COOKIE);
  if (!id) return null;
  const sandbox = await loadSandbox(c.env, id);
  if (!sandbox) {
    deleteCookie(c, COOKIE, { path: "/" });
    return null;
  }
  if (Date.now() - sandbox.lastActiveAt > TOUCH_INTERVAL_MS) await saveSandbox(c.env, sandbox);
  return sandbox;
};

export const createSandbox = async (c: AppContext, username: string) => {
  const now = Date.now();
  const sandbox: Sandbox = {
    id: crypto.randomUUID(),
    username,
    bio: "",
    createdAt: now,
    lastActiveAt: now,
    posts: [],
    comments: [],
    likes: {},
  };
  await saveSandbox(c.env, sandbox);
  setCookie(c, COOKIE, sandbox.id, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: KV_TTL_SECONDS,
  });
  return sandbox;
};

const ADJECTIVES = [
  "calm",
  "quiet",
  "sunny",
  "misty",
  "gentle",
  "bright",
  "cosy",
  "mellow",
  "breezy",
  "steady",
];
const NOUNS = [
  "otter",
  "heron",
  "fern",
  "pebble",
  "maple",
  "harbour",
  "lantern",
  "meadow",
  "comet",
  "willow",
];
const pick = (list: string[]) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];

/** A friendly random username, like "misty_heron_42". Visitors can change it later. */
export const randomUsername = () => {
  let username: string;
  do {
    username = `${pick(ADJECTIVES)}_${pick(NOUNS)}_${10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90)}`;
  } while (EXAMPLE_AUTHORS.has(username));
  return username;
};

// Crawlers and link previews would otherwise leave a sandbox behind on every visit.
const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|python-requests|headless/i;

/**
 * The visitor's sandbox, creating one with a random username on their first visit, so there's
 * no sign-up step. Bots get null and see the site signed out.
 */
export const ensureSandbox = async (c: AppContext) => {
  const sandbox = await currentSandbox(c);
  if (sandbox) return sandbox;
  if (BOT_USER_AGENT.test(c.req.header("user-agent") ?? "")) return null;
  return createSandbox(c, randomUsername());
};

export const endSession = (c: AppContext) => deleteCookie(c, COOKIE, { path: "/" });

/** Shows a message on the next page the visitor sees. */
export const flash = async (env: Env, sandbox: Sandbox, message: Flash) => {
  sandbox.flash = message;
  await saveSandbox(env, sandbox);
};

export const takeFlash = async (env: Env, sandbox: Sandbox | null) => {
  const message = sandbox?.flash;
  if (sandbox && message) {
    delete sandbox.flash;
    await saveSandbox(env, sandbox);
  }
  return message ?? null;
};

/** Webhooks only carry an asset ID, so remember which sandbox each asset belongs to. */
export const rememberAsset = (env: Env, assetId: string, sandboxId: string) =>
  env.CALMGRAM.put(assetKey(assetId), sandboxId, { expirationTtl: KV_TTL_SECONDS });

export const sandboxForAsset = async (env: Env, assetId: string) => {
  const id = await env.CALMGRAM.get(assetKey(assetId));
  return id ? loadSandbox(env, id) : null;
};

/** Deletes sandboxes unused for 24 hours, and their images and text records on CalmLens. */
export const deleteExpiredSandboxes = async (env: Env, moderation: ModerationProvider) => {
  const cutoff = Date.now() - SANDBOX_LIFETIME_MS;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await env.CALMGRAM.list<{ lastActiveAt: number }>({ prefix: "sandbox:", cursor });
    for (const key of page.keys) {
      if ((key.metadata?.lastActiveAt ?? 0) > cutoff) continue;
      const sandbox = await env.CALMGRAM.get<Sandbox>(key.name, "json");
      const assetIds = [
        ...(sandbox?.posts ?? []).map((post) => post.assetId),
        ...(sandbox?.comments ?? []).map((comment) => comment.assetId),
      ];
      const results = await Promise.allSettled(assetIds.map((id) => moderation.deleteAsset(id)));
      if (results.some((result) => result.status === "rejected")) continue; // retry next hour
      await Promise.all([
        ...assetIds.map((id) => env.CALMGRAM.delete(assetKey(id))),
        env.CALMGRAM.delete(key.name),
      ]);
      deleted++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return deleted;
};
