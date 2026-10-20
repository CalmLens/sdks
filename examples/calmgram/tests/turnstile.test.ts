import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../src/data";
import { requireHuman, signClearance, VERIFY_PATH } from "../src/turnstile";

const KEYS = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" };
const ORIGIN = "https://example.calmlens.com";

const app = new Hono<{ Bindings: Env }>();
app.use("*", requireHuman);
app.all("*", (c) => c.text("app"));

const request = (path: string, env: Partial<Env>, init?: RequestInit) =>
  app.request(`${ORIGIN}${path}`, init, env as Env);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers Turnstile's siteverify with `result`, recording what was sent. */
const stubSiteverify = (result: { success: boolean }) => {
  const sent: FormData[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(init.body as FormData);
    return Response.json(result);
  }) as typeof fetch;
  return sent;
};

const verify = (token: string, next = "/p/seed-2") => {
  const body = new FormData();
  body.set("cf-turnstile-response", token);
  body.set("next", next);
  return request(VERIFY_PATH, KEYS, { method: "POST", body });
};

test("serves the app without a check when Turnstile keys aren't set", async () => {
  const response = await request("/", {});
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("app");
});

test("shows the Turnstile challenge instead of the page to visitors without clearance", async () => {
  const response = await request("/p/seed-2", KEYS);
  expect(response.status).toBe(403);
  const html = await response.text();
  expect(html).toContain('data-sitekey="site-key"');
  expect(html).toContain('name="next" value="/p/seed-2"');
  expect(await (await request("/posts", KEYS, { method: "POST" })).text()).not.toBe("app");
});

test("lets CalmLens webhook deliveries through without clearance", async () => {
  const response = await request("/api/webhooks/calmlens", KEYS, { method: "POST" });
  expect(await response.text()).toBe("app");
});

test("verifies the token, sets a clearance cookie and returns the visitor to their page", async () => {
  const sent = stubSiteverify({ success: true });
  const response = await verify("token-1");
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/p/seed-2");
  expect(sent[0]?.get("secret")).toBe("secret-key");
  expect(sent[0]?.get("response")).toBe("token-1");

  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const cleared = await request("/p/seed-2", KEYS, { headers: { cookie } });
  expect(await cleared.text()).toBe("app");
});

test("refuses tokens Turnstile rejects", async () => {
  stubSiteverify({ success: false });
  const rejected = await verify("bad");
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get("set-cookie")).toBeNull();
});

test("never redirects off-site after verifying", async () => {
  stubSiteverify({ success: true });
  for (const next of ["//evil.example/x", "https://evil.example", "/\\evil.example"]) {
    expect((await verify("token", next)).headers.get("location")).toBe("/");
  }
});

test("ignores expired, forged and malformed clearance cookies", async () => {
  const expired = await signClearance("secret-key", Date.now() - 1000);
  const forged = await signClearance("another-secret", Date.now() + 60_000);
  const [expiry] = (await signClearance("secret-key", Date.now() + 60_000)).split(".");
  for (const value of [expired, forged, `${expiry}.wrong`, "garbage"]) {
    const response = await request("/", KEYS, { headers: { cookie: `calmgram_human=${value}` } });
    expect(response.status).toBe(403);
  }
});
