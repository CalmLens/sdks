import type data from "./example-data.json";

type ExamplePostMedia = NonNullable<(typeof data.posts)[number]["media"]>;

/** Both apps serve the same local photos and illustrations from assets/post-examples. */
export const PHOTOGRAPHS: readonly ExamplePostMedia[] = [
  "garden",
  "bread",
  "kitten",
  "puppy",
  "mountain-lake",
];
export const examplePostArtworkUrl = (media: ExamplePostMedia) =>
  `/post-examples/${media}.${PHOTOGRAPHS.includes(media) ? "webp" : "svg"}`;

export type ExamplePostAssetType = "Text" | "Image" | "Audio" | "Video" | "Document" | "Website";
export const examplePostAssetType = (media?: ExamplePostMedia): ExamplePostAssetType => {
  if (!media) return "Text";
  if (media === "voice") return "Audio";
  if (media === "video") return "Video";
  if (media === "document") return "Document";
  if (media === "website") return "Website";
  return "Image";
};
