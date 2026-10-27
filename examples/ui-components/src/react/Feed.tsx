import type { AssetModerationStatus } from "@calmlens/sdk/app";
import { SensitiveImage } from "./SensitiveImage";

type Post = {
  id: string;
  assetId: string;
  status: AssetModerationStatus;
  alt: string;
  aspectRatio: number;
};
type ShownPost = Post & { status: "allowed" | "limited" | "age-restricted" };

const isShown = (post: Post): post is ShownPost =>
  post.status === "allowed" || post.status === "limited" || post.status === "age-restricted";

type FeedProps = {
  projectId: string;
  posts: Post[];
  viewer: { ageConfirmed: boolean };
  onReveal: () => void;
};

export function Feed({ projectId, posts, viewer, onReveal }: FeedProps) {
  return (
    <ul className="feed">
      {posts.filter(isShown).map((post) => (
        <li key={post.id}>
          <SensitiveImage
            projectId={projectId}
            assetId={post.assetId}
            status={post.status}
            ageConfirmed={viewer.ageConfirmed}
            onReveal={onReveal}
            alt={post.alt}
            aspectRatio={post.aspectRatio}
          />
        </li>
      ))}
    </ul>
  );
}
