import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "./data";
import { buttonClass } from "./views";

// Hosting protection for the public demo, not part of the CalmLens integration: with
// TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY set, visitors pass a Cloudflare Turnstile check
// before any page runs, so crawlers never create sandboxes or spend CalmLens calls. Without the
// keys (local development) the check is skipped.

type AppContext = Context<{ Bindings: Env }>;

const COOKIE = "calmgram_human";
const CLEARANCE_SECONDS = 24 * 60 * 60;
export const VERIFY_PATH = "/verify-human";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Paths that skip the check: CalmLens webhook deliveries are verified by their signature. */
const isExempt = (path: string) => path.startsWith("/api/webhooks/");

const turnstileKeys = (env: Env) =>
  env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY
    ? { siteKey: env.TURNSTILE_SITE_KEY, secretKey: env.TURNSTILE_SECRET_KEY }
    : null;

const hmac = async (secret: string, data: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`calmgram-clearance:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

/** A clearance value: `<expiry in ms>.<signature>`. */
export const signClearance = async (secret: string, expiresAt: number) =>
  `${expiresAt}.${await hmac(secret, String(expiresAt))}`;

export const isValidClearance = async (secret: string, value: string | undefined, now: number) => {
  const [expiry, signature] = value?.split(".") ?? [];
  const expiresAt = Number(expiry);
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  return (await hmac(secret, expiry)) === signature;
};

/** Only same-site paths, so the check can't be used as an open redirect. */
export const safeNextPath = (next: unknown) =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/";

const challengePage = (siteKey: string, next: string, failed: boolean) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Checking your browser · Calmgram</title>
<link rel="stylesheet" href="/styles.css">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
<main class="mx-auto mt-16 grid max-w-[360px] gap-4 px-4 text-center">
<h1 class="font-logo text-[44px] font-semibold">Calmgram</h1>
<p class="text-muted">Checking that you're a person before opening your sandbox.</p>
${failed ? '<p role="alert">That check didn\'t work. Please try again.</p>' : ""}
<form method="post" action="${VERIFY_PATH}" id="turnstile-form" class="grid justify-center gap-3">
<input type="hidden" name="next" value="${next.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}">
<div class="cf-turnstile" data-sitekey="${siteKey}"${failed ? "" : ' data-callback="calmgramVerified"'}></div>
${failed ? `<button type="submit" class="${buttonClass()}">Try again</button>` : ""}
</form>
</main>
<script>
// Continues as soon as the check passes. After a failed check, the visitor submits it again
// themselves, so a token the server keeps refusing can't submit in a loop.
function calmgramVerified(){document.getElementById("turnstile-form").submit()}
</script>
</body>
</html>`;

const verifyToken = async (secretKey: string, token: string, ip: string | undefined) => {
  const body = new FormData();
  body.set("secret", secretKey);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);
  const response = await fetch(SITEVERIFY_URL, { method: "POST", body });
  if (!response.ok) return null;
  return (await response.json()) as { success: boolean };
};

const handleVerify = async (c: AppContext, keys: { secretKey: string; siteKey: string }) => {
  const form = await c.req.formData();
  const next = safeNextPath(form.get("next"));
  const token = form.get("cf-turnstile-response");
  const result =
    typeof token === "string" && token
      ? await verifyToken(keys.secretKey, token, c.req.header("cf-connecting-ip"))
      : null;
  // The widget's hostname allowlist (set on the Turnstile dashboard) ties tokens to this site.
  if (!result?.success) {
    return c.html(challengePage(keys.siteKey, next, true), 403);
  }
  const expiresAt = Date.now() + CLEARANCE_SECONDS * 1000;
  setCookie(c, COOKIE, await signClearance(keys.secretKey, expiresAt), {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: CLEARANCE_SECONDS,
  });
  return c.redirect(next, 303);
};

export const requireHuman: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const keys = turnstileKeys(c.env);
  if (!keys || isExempt(c.req.path)) return next();
  if (c.req.path === VERIFY_PATH && c.req.method === "POST") return handleVerify(c, keys);
  if (await isValidClearance(keys.secretKey, getCookie(c, COOKIE), Date.now())) return next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.text("Please reload the page and try again.", 403);
  }
  const url = new URL(c.req.url);
  return c.html(challengePage(keys.siteKey, url.pathname + url.search, false), 403);
};
