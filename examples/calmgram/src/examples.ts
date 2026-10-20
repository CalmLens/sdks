import type { Post } from "./data";
import data from "./example-data.json";
export const EXAMPLE_AUTHORS = new Set(data.feed.map((post) => post.author));
export const EXAMPLE_POSTS_BY_ID = new Map(data.posts.map((post) => [post.id, post]));
export const exampleFeedFor = (anchor: number): Post[] =>
  data.feed.map((post) => ({
    ...post,
    createdAt: post.createdAt + anchor,
    checkedAt: anchor,
  })) as Post[];
export const exampleContentType = (post: Post) => {
  const media = post.exampleId ? EXAMPLE_POSTS_BY_ID.get(post.exampleId)?.media : undefined;
  if (!post.exampleId) return "Image";
  if (!media) return "Text";
  return (
    (
      { voice: "Audio", video: "Video", document: "Document", website: "Website" } as Record<
        string,
        string
      >
    )[media] ?? "Image"
  );
};
