const CATEGORY_NAMES = {
  harassment: "harassment",
  hate: "hate speech",
  sexual: "sexual content",
  violence: "violence",
  "self-harm": "self-harm",
  "criminal-activity": "criminal activity",
  profanity: "profanity",
  "personal-information": "personal information",
};

function refusalMessage({ categories = [] }) {
  const names = categories.map((category) => CATEGORY_NAMES[category]).filter(Boolean);
  return names.length
    ? `Your comment wasn't posted because it may contain ${names.join(", ")}. Edit it and try again.`
    : "Your comment wasn't posted because it may break our community guidelines.";
}

export function attachCommentForm(form, { postId, onPosted }) {
  const button = form.querySelector("button[type=submit]");
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.hidden = true;
  button.before(error);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = "Posting…";
    error.hidden = true;
    const response = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      body: new FormData(form),
    });
    const result = await response.json();
    button.disabled = false;
    button.textContent = "Post";
    if (response.ok) {
      form.reset();
      onPosted(result);
    } else {
      error.textContent =
        result.code === "comment/refused"
          ? refusalMessage(result)
          : "Your comment wasn't posted. Please try again.";
      error.hidden = false;
    }
  });
}
