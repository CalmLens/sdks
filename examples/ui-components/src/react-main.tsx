import { useState } from "react";
import { createRoot } from "react-dom/client";
import { posts, projectId, revealedUrls, show } from "./demo";
import { Avatar } from "./react/Avatar";
import { CommentForm } from "./react/CommentForm";
import { Feed } from "./react/Feed";
import { PhotoUpload } from "./react/PhotoUpload";

function App() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  return (
    <main style={{ maxWidth: 480 }}>
      <PhotoUpload onUploaded={(upload: unknown) => show("Uploaded", upload)} />
      <CommentForm postId="1" onPosted={(comment: unknown) => show("Posted", comment)} />
      <Avatar projectId={projectId} assetId={posts[0].assetId} status="allowed" name="Sam" />
      <Feed
        projectId={projectId}
        posts={posts}
        revealedUrls={urls}
        onReveal={() => setUrls(revealedUrls())}
      />
    </main>
  );
}

createRoot(document.getElementById("app") as HTMLElement).render(<App />);
