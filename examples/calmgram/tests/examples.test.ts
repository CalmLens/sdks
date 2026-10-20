import { expect, test } from "bun:test";
import data from "../src/example-data.json";

const MODERATION_EXAMPLE_POSTS = data.posts;

import { imageUrlFor, loadFeed } from "../src/content";
import type { Env } from "../src/data";
import { exampleFeedFor } from "../src/examples";
import app from "../src/index";

// No KV or API bindings: viewing fixed examples must not need either.
const env = { CALMLENS_DEMO: "1" } as Env;

test("loads the shared examples without provisioning assets or storing a seed feed", async () => {
  const feed = await loadFeed(env, null);
  expect(feed.posts.map((post) => post.exampleId)).toEqual(
    MODERATION_EXAMPLE_POSTS.map((post) => post.id),
  );
  expect(new Set(feed.posts.map((post) => post.id)).size).toBe(MODERATION_EXAMPLE_POSTS.length);
  const examples = exampleFeedFor(100_000);
  expect(examples.find((post) => post.exampleId === "obituary")?.status).toBe("approved");
  expect(examples.find((post) => post.exampleId === "hate-exclusion")?.status).toBe("rejected");
  expect(examples.find((post) => post.exampleId === "adult-ad")?.status).toBe("rejected");
  expect(imageUrlFor(env, examples[0], "feed")).toBeNull();
});

test("the first page already contains example queue entries without KV or API access", async () => {
  const response = await app.fetch(
    new Request("http://localhost/", { headers: { "user-agent": "Googlebot" } }),
    env,
  );
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("/p/example-obituary");
  expect(html).toContain("/p/example-insult");
  expect(html).not.toContain('action="/p/example-insult/delete"');
  expect(html).not.toContain("/demo-media/example-");
});
