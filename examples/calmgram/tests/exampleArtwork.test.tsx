import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { examplePostArtworkUrl } from "../src/example-artwork";
import data from "../src/example-data.json";

const MODERATION_EXAMPLE_POSTS = data.posts;

import { exampleFeedFor } from "../src/examples";
import { PostImage } from "../src/views";

const posts = exampleFeedFor(100_000);
test("curated images use shared artwork while blocked examples stay concealed", () => {
  const garden = posts.find((post) => post.exampleId === "garden")!;
  expect((<PostImage post={garden} variant="feed" url={null} />).toString()).toContain(
    "/post-examples/garden.webp",
  );
  const blocked = posts.find((post) => post.exampleId === "graphic-clip")!;
  expect(blocked.status).toBe("blocked");
  expect((<PostImage post={blocked} variant="feed" url={null} />).toString()).not.toContain(
    "/post-examples/",
  );
});

test("every catalogue illustration has a maintained shared source", () => {
  for (const post of MODERATION_EXAMPLE_POSTS) {
    if (post.media)
      expect(
        existsSync(new URL(`../../../assets${examplePostArtworkUrl(post.media)}`, import.meta.url)),
      ).toBe(true);
  }
});
