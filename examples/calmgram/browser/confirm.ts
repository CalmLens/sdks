// Asks before a destructive form post, such as deleting a post or starting over, in the page's
// native <dialog> (ConfirmDialog in src/views.tsx). Bundled to public/confirm.js by
// `bun run build:client`.
//
// PostButton renders those forms with data-confirm-title, data-confirm-description and
// data-confirm-action. Without JavaScript they post straight away.

const dialog = document.querySelector<HTMLDialogElement>("#confirm-dialog");
const title = document.querySelector<HTMLElement>("#confirm-title");
const description = document.querySelector<HTMLElement>("#confirm-description");
const action = document.querySelector<HTMLButtonElement>("#confirm-action");

let pending: HTMLFormElement | null = null;

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !dialog || !title || !description || !action) return;
  const { confirmTitle, confirmDescription, confirmAction } = form.dataset;
  if (!confirmTitle) return;
  event.preventDefault();
  pending = form;
  title.textContent = confirmTitle;
  description.textContent = confirmDescription ?? "";
  description.hidden = !confirmDescription;
  action.textContent = confirmAction ?? "Confirm";
  dialog.returnValue = "";
  dialog.showModal();
});

// The dialog's own form closes it with the clicked button's value; Escape closes it with none.
dialog?.addEventListener("close", () => {
  const form = pending;
  pending = null;
  // submit() skips the submit event, so this doesn't ask again.
  if (form && dialog.returnValue === "confirm") form.submit();
});

// A click on the backdrop lands on the dialog itself, outside its content.
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
