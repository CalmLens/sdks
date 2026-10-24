import { type FormEvent, useState } from "react";

const CATEGORY_NAMES: Record<string, string> = {
  harassment: "harassment",
  hate: "hate speech",
  sexual: "sexual content",
  violence: "violence",
  "self-harm": "self-harm",
  "criminal-activity": "criminal activity",
  profanity: "profanity",
  "personal-information": "personal information",
};

function refusalMessage({ categories = [] }: { categories?: string[] }) {
  const names = categories.map((category) => CATEGORY_NAMES[category]).filter(Boolean);
  return names.length
    ? `Your comment wasn't posted because it may contain ${names.join(", ")}. Edit it and try again.`
    : "Your comment wasn't posted because it may break our community guidelines.";
}

type CommentFormProps = {
  postId: string;
  onPosted: (comment: { id: string; status: string }) => void;
};

export function CommentForm({ postId, onPosted }: CommentFormProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    setError("");
    const response = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      body: new FormData(form),
    });
    const result = await response.json();
    setSending(false);
    if (response.ok) {
      form.reset();
      onPosted(result);
    } else {
      setError(
        result.code === "comment/refused"
          ? refusalMessage(result)
          : "Your comment wasn't posted. Please try again.",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Comment <textarea name="body" required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={sending}>
        {sending ? "Posting…" : "Post"}
      </button>
    </form>
  );
}
