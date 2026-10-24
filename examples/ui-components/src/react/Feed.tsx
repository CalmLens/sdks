import type { AssetModerationStatus } from "@calmlens/sdk/app";
import { SensitiveImage } from "./SensitiveImage";

type Post = {
  id: string;
  assetId: string;
  status: AssetModerationStatus;
  alt: string;
  aspectRatio: number;
};
type ShownPost = Post & { status: "allowed" | "age-restricted" };

const isShown = (post: Post): post is ShownPost =>
  post.status === "allowed" || post.status === "age-restricted";

type FeedProps = {
  projectId: string;
  posts: Post[];
  /** Signed URLs for the age-restricted images this viewer may see, by asset ID. */
  revealedUrls: Record<string, string>;
  onReveal: () => void;
};

export function Feed({ projectId, posts, revealedUrls, onReveal }: FeedProps) {
  return (
    <ul className="feed">
      {posts.filter(isShown).map((post) => (
        <li key={post.id}>
          <SensitiveImage
            projectId={projectId}
            assetId={post.assetId}
            status={post.status}
            contentUrl={revealedUrls[post.assetId]}
            onReveal={onReveal}
            alt={post.alt}
            aspectRatio={post.aspectRatio}
          />
        </li>
      ))}
    </ul>
  );
}
