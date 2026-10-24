import { getAssetUrl } from "@calmlens/sdk/app";

// Sample data for the demo pages. Point them at your project with VITE_CALMLENS_PROJECT_ID and
// replace the asset IDs with public assets from it. Uploads and comments call /api/upload-token
// and /api/posts/:postId/comments, which your server provides.
export const projectId: string = import.meta.env.VITE_CALMLENS_PROJECT_ID ?? "your-project-id";

export type DemoPost = {
  id: string;
  assetId: string;
  status: "allowed" | "age-restricted" | "blocked";
  alt: string;
  aspectRatio: number;
};

export const posts: DemoPost[] = [
  {
    id: "1",
    assetId: "allowed-asset-id",
    status: "allowed",
    alt: "A beach at sunset",
    aspectRatio: 1.5,
  },
  {
    id: "2",
    assetId: "age-restricted-asset-id",
    status: "age-restricted",
    alt: "A sensitive photo",
    aspectRatio: 0.75,
  },
  {
    id: "3",
    assetId: "blocked-asset-id",
    status: "blocked",
    alt: "A blocked photo",
    aspectRatio: 1,
  },
];

/**
 * The URLs a viewer who chose to see sensitive media gets, by asset ID. Your app asks its server,
 * which checks the viewer and returns short-lived signed URLs. These pages have no server, so they
 * gate in the page with the `allowAgeRestricted` opt-in instead.
 */
export const revealedUrls = (): Record<string, string> =>
  Object.fromEntries(
    posts
      .filter((post) => post.status === "age-restricted")
      .map((post) => [
        post.assetId,
        getAssetUrl({ projectId, assetIdentifier: post.assetId, allowAgeRestricted: true }),
      ]),
  );

/** Shows what a component reported, under the demo. */
export function show(label: string, value: unknown) {
  const line = document.createElement("pre");
  line.textContent = `${label}: ${JSON.stringify(value)}`;
  document.body.append(line);
}
