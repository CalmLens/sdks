import { expect, test } from "bun:test";
import type { Post } from "../src/data";
import { exampleFeedFor, isExamplePhoto } from "../src/examples";
import { queueName } from "../src/index";
import { PostCard } from "../src/views";

const post = (status: Post["status"]): Post => ({
  id: "p1",
  author: "maya.hills",
  caption: "Saturday night.",
  createdAt: 0,
  assetId: "asset-1",
  status,
  findings: [{ category: "violence", score: 0.95 }],
  checkedAt: Date.now(),
});

/** The post forms a rendered card offers, by action. */
const formActions = async (html: string) => {
  const actions: string[] = [];
  await new HTMLRewriter()
    .on("form", { element: (el) => void actions.push(el.getAttribute("action") ?? "") })
    .transform(new Response(html))
    .text();
  return actions;
};

const card = (status: Post["status"], viewer: string | null) =>
  formActions(
    (
      <PostCard post={post(status)} imageUrl={null} comments={[]} likes={[]} viewer={viewer} />
    ).toString(),
  );

test("the photo feed shows only the examples that are photographs", () => {
  const shown = exampleFeedFor(0)
    .filter(isExamplePhoto)
    .map((example) => example.exampleId);
  expect(shown).toContain("garden");
  expect(shown).toContain("kitten");
  // Text, video and illustration examples stay in the moderation queue only.
  expect(shown).not.toContain("obituary");
  expect(shown).not.toContain("battlefield");
  expect(shown).not.toContain("birthday");
});

test("the author can delete a post that wasn't published, and retry one that failed", async () => {
  expect(await card("blocked", "maya.hills")).toEqual(["/p/p1/delete"]);
  expect(await card("error", "maya.hills")).toEqual(["/p/p1/retry", "/p/p1/delete"]);
  // Nothing to act on while it's checked, and published posts get likes instead.
  expect(await card("pending", "maya.hills")).toEqual([]);
  expect(await card("allowed", "maya.hills")).toEqual(["/p/p1/like"]);
});

test("the queue names a test input by its category instead of its authentication tag", () => {
  const text = "<!calmlens-test a775108e09ac7aa36bfc8f59b56b494a harassment>";
  const name = queueName({
    kind: "comment",
    item: { ...post("blocked"), postId: "p1", text },
  });
  expect(name).not.toContain("a775108e09ac7aa36bfc8f59b56b494a");
  expect(name).toContain("harassment");
});
