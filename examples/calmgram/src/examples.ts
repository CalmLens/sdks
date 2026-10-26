import type { Post } from "./data";
import { PHOTOGRAPHS } from "./example-artwork";
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

/** Example posts that are photographs, the only examples a photo feed shows. */
export const isExamplePhoto = (post: Post) => {
  const media = post.exampleId ? EXAMPLE_POSTS_BY_ID.get(post.exampleId)?.media : undefined;
  return !!media && PHOTOGRAPHS.includes(media);
};

/**
 * A fixed like count for an example post, so the shared feed doesn't look empty. It is derived
 * from the example's ID, so it never changes between visits; a visitor's own like adds one.
 */
export const exampleLikeCount = (exampleId: string) =>
  12 + ([...exampleId].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 997, 7) % 230);
