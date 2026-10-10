// App-styled confirmation with native modal focus management and safe cancellation.
function confirmAction(message, requiredText = null) {
  const returnFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog confirm-dialog";
  dialog.setAttribute("aria-label", "Confirm action");
  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.textContent = "Confirm action";
  const copy = document.createElement("p");
  copy.textContent = message;
  const actions = document.createElement("div");
  actions.className = "confirm-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "submit";
  cancel.value = "cancel";
  cancel.className = "secondary-button";
  cancel.textContent = "Cancel";
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.value = "confirm";
  confirm.className = "primary-button";
  confirm.textContent = "Confirm";
  actions.append(cancel, confirm);
  form.append(heading, copy, actions);
  if (requiredText) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = `Type ${requiredText} to confirm`;
    const input = document.createElement("input");
    input.type = "text";
    input.required = true;
    input.autocomplete = "off";
    confirm.disabled = true;
    input.addEventListener("input", () => { confirm.disabled = input.value !== requiredText; });
    form.addEventListener("submit", event => {
      if (event.submitter === confirm && input.value !== requiredText) event.preventDefault();
    });
    cancel.formNoValidate = true;
    label.append(caption, input);
    form.insertBefore(label, actions);
  }
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("keydown", event => {
    // Escape dismisses this modal without also closing the underlying map form.
    if (event.key === "Escape") event.stopPropagation();
  });
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const accepted = dialog.returnValue === "confirm";
      dialog.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(accepted);
    }, { once: true });
    dialog.showModal();
    cancel.focus();
  });
}
