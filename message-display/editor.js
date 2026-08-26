(() => {
  if (globalThis.__iosImapNotesMessageEditorLoaded) {
    return;
  }
  globalThis.__iosImapNotesMessageEditorLoaded = true;

  let editorState = null;

  function getMessage(key, fallback) {
    return browser.i18n.getMessage(key) || fallback;
  }

  function createButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function getSubject(surface, fallback) {
    const firstLine = surface.innerText
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    return firstLine || fallback || getMessage("newNoteDefaultTitle", "New note");
  }

  function setBusy(isBusy, error = "") {
    if (!editorState) {
      return;
    }
    editorState.shell.dataset.busy = String(isBusy);
    editorState.surface.contentEditable = String(!isBusy);
    editorState.saveButton.disabled = isBusy;
    editorState.cancelButton.disabled = isBusy;
    editorState.statusLabel.textContent = isBusy
      ? getMessage("savingNote", "Saving note…")
      : getMessage("editingNote", "Editing Apple note");
    editorState.error.textContent = error;
  }

  function finishEditing({ restore = false } = {}) {
    if (!editorState) {
      return;
    }

    const { host, originalNodes, shell, surface } = editorState;
    const nodes = restore
      ? originalNodes.map(node => node.cloneNode(true))
      : [...surface.childNodes];
    shell.remove();
    host.replaceChildren(...nodes);
    document.body.classList.remove("ios-imap-notes-editing");
    editorState = null;
    browser.runtime.sendMessage({ command: "notes:editing-finished" });
  }

  async function save() {
    if (!editorState) {
      return;
    }

    setBusy(true);
    const response = await browser.runtime.sendMessage({
      command: "notes:save",
      bodyHtml: editorState.surface.innerHTML,
      subject: getSubject(editorState.surface, editorState.originalSubject),
    });

    if (!response?.ok) {
      setBusy(false, response?.error || getMessage("saveFailed", "The note could not be saved."));
      return;
    }

    finishEditing();
  }

  function cancel() {
    finishEditing({ restore: true });
  }

  function beginEditing(note) {
    if (editorState || !note?.isAppleNote) {
      return;
    }

    const host = document.querySelector(".moz-text-html") || document.body;
    const originalNodes = [...host.childNodes]
      .map(node => node.cloneNode(true));
    const displayedNodes = [...host.childNodes];
    host.replaceChildren();
    document.body.classList.add("ios-imap-notes-editing");

    const shell = document.createElement("div");
    shell.id = "ios-imap-notes-editor-shell";
    shell.dataset.busy = "false";

    const status = document.createElement("div");
    status.id = "ios-imap-notes-editor-status";
    status.contentEditable = "false";

    const statusLabel = document.createElement("span");
    statusLabel.id = "ios-imap-notes-editor-status-label";
    statusLabel.textContent = getMessage("editingNote", "Editing Apple note");

    const error = document.createElement("span");
    error.id = "ios-imap-notes-editor-error";

    const cancelButton = createButton(getMessage("cancel", "Cancel"), cancel);
    const saveButton = createButton(getMessage("save", "Save"), save);

    status.append(statusLabel, error, cancelButton, saveButton);

    const surface = document.createElement("div");
    surface.id = "ios-imap-notes-editor-surface";
    surface.contentEditable = "true";
    surface.spellcheck = true;
    surface.append(...displayedNodes);

    shell.append(status, surface);
    host.append(shell);

    editorState = {
      host,
      originalNodes,
      originalSubject: note.subject,
      shell,
      statusLabel,
      error,
      surface,
      cancelButton,
      saveButton,
    };

    surface.focus();
    browser.runtime.sendMessage({ command: "notes:editing-started" });
  }

  browser.runtime.onMessage.addListener(message => {
    switch (message?.command) {
      case "notes:begin-edit":
        beginEditing(message.note);
        break;
      case "notes:save-request":
        save();
        break;
      case "notes:cancel-edit":
        cancel();
        break;
    }
  });

  document.addEventListener("keydown", event => {
    if (!editorState) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    }
  });

  browser.runtime.sendMessage({ command: "notes:display-ready" });
})();
