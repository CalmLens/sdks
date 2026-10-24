<script lang="ts">
  type Props = { postId: string; onPosted: (comment: { id: string; status: string }) => void };
  let { postId, onPosted }: Props = $props();
  let sending = $state(false);
  let error = $state("");

  const CATEGORY_NAMES: Record<string, string> = {
    harassment: "harassment", hate: "hate speech", sexual: "sexual content", violence: "violence",
    "self-harm": "self-harm", "criminal-activity": "criminal activity", profanity: "profanity",
    "personal-information": "personal information",
  };

  function refusalMessage({ categories = [] }: { categories?: string[] }) {
    const names = categories.map((category) => CATEGORY_NAMES[category]).filter(Boolean);
    return names.length
      ? `Your comment wasn't posted because it may contain ${names.join(", ")}. Edit it and try again.`
      : "Your comment wasn't posted because it may break our community guidelines.";
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    sending = true;
    error = "";
    const response = await fetch(`/api/posts/${postId}/comments`, { method: "POST", body: new FormData(form) });
    const result = await response.json();
    sending = false;
    if (response.ok) {
      form.reset();
      onPosted(result);
    } else {
      error = result.code === "comment/refused" ? refusalMessage(result) : "Your comment wasn't posted. Please try again.";
    }
  }
</script>

<form onsubmit={handleSubmit}>
  <label>Comment <textarea name="body" required></textarea></label>
  {#if error}<p role="alert">{error}</p>{/if}
  <button type="submit" disabled={sending}>{sending ? "Posting…" : "Post"}</button>
</form>
