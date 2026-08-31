import { getPref } from "./options/defaults.mjs";
import {
  APPLE_NOTE_UTI,
  createAppleNoteDocument,
  getAppleNoteRevision,
  getAppleNoteUuid,
  isAppleNote,
  isAppleNoteEditable,
  replaceAppleNoteBody,
  waitForAppleNote,
} from "./scripts/apple-note.mjs";
import { createRawAppleNoteMessage } from "./scripts/rfc822.mjs";

const EDIT_MENU_ID = "iosNotesEdit";
const NEW_NOTE_MENU_ID = "iosNotesNew";
const DISPLAY_SCRIPT_ID = "ios-imap-notes-message-editor";
const editingTabs = new Map();
const pendingAutoEdit = new Map();
const savingTabs = new Set();
const MAX_INLINE_IMAGE_PREVIEW_BYTES = 6 * 1024 * 1024;

function text(key, fallback) {
  return browser.i18n.getMessage(key) || fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function showError(error) {
  console.error(error);
  await browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("images/error.png"),
    title: text("extName", "iOS IMAP Notes"),
    message: errorMessage(error),
  });
}

async function getDisplayedMessage(tabId) {
  try {
    return await browser.messageDisplay.getDisplayedMessage(tabId);
  } catch (error) {
    console.debug("No displayed message for tab", tabId, error);
    return null;
  }
}

async function getNote(messageId, options = {}) {
  const note = await waitForAppleNote(
    () => browser.messages.getFull(messageId),
    options,
  );
  if (!note) {
    return null;
  }
  return {
    ...note,
    header: await browser.messages.get(messageId),
  };
}

function normalizeContentId(value) {
  return String(value || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => resolve(String(reader.result || "")),
      { once: true },
    );
    reader.addEventListener(
      "error",
      () => reject(reader.error || new Error("Could not read inline image.")),
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

async function getInlineImagePreviews(messageId) {
  const attachments = await browser.messages.listAttachments(messageId);
  const previews = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const contentId = normalizeContentId(attachment.contentId);
    const contentType = String(attachment.contentType || "").toLowerCase();
    if (!contentId || !contentType.startsWith("image/") || !attachment.partName) {
      continue;
    }
    const declaredSize = Number(attachment.size || 0);
    if (declaredSize > MAX_INLINE_IMAGE_PREVIEW_BYTES
        || totalBytes + declaredSize > MAX_INLINE_IMAGE_PREVIEW_BYTES) {
      continue;
    }
    const file = await browser.messages.getAttachmentFile(messageId, attachment.partName);
    if (!file || file.size > MAX_INLINE_IMAGE_PREVIEW_BYTES
        || totalBytes + file.size > MAX_INLINE_IMAGE_PREVIEW_BYTES) {
      continue;
    }
    previews.push({
      contentId,
      dataUrl: await fileToDataUrl(file),
      name: attachment.name || file.name || "Image",
    });
    totalBytes += file.size;
  }
  return previews;
}

async function showInlineImages(tabId, messageId) {
  try {
    const images = await getInlineImagePreviews(messageId);
    if (images.length) {
      await browser.tabs.sendMessage(tabId, {
        command: "notes:show-inline-images",
        images,
      });
    }
  } catch (error) {
    console.debug("Could not show Apple note inline images", error);
  }
}

async function updateAction(tabId, appleNote, mode = "view", editable = true) {
  try {
    await browser.notesHeader.setNoteMode(
      tabId,
      appleNote,
      text("newNote", "New note"),
    );
  } catch (error) {
    console.error("Could not update the Apple Notes message header", error);
  }

  if (!appleNote) {
    editingTabs.delete(tabId);
    await browser.messageDisplayAction.disable(tabId);
    return;
  }

  const saving = mode === "edit";
  await Promise.all([
    browser.messageDisplayAction.setTitle({
      tabId,
      title: saving
        ? text("saveNote", "Save note")
        : text("editNote", "Edit note"),
    }),
    browser.messageDisplayAction.setLabel({
      tabId,
      label: saving
        ? text("saveNote", "Save note")
        : text("editNote", "Edit note"),
    }),
  ]);
  if (editable) {
    await browser.messageDisplayAction.enable(tabId);
  } else {
    await browser.messageDisplayAction.disable(tabId);
  }
}

async function refreshDisplayedMessage(tab, message) {
  if (!message) {
    await updateAction(tab.id, false);
    return;
  }

  try {
    if (await tryPendingAutoEdit(tab.id, message)) {
      return;
    }
    const full = await browser.messages.getFull(message.id);
    const appleNote = isAppleNote(full);
    const editable = isAppleNoteEditable(full);
    const alreadyEditing = isSameMessage(editingTabs.get(tab.id), message);
    if (!alreadyEditing) {
      editingTabs.delete(tab.id);
    }
    await updateAction(tab.id, appleNote, alreadyEditing ? "edit" : "view", editable);
    if (appleNote && !editable) {
      await showInlineImages(tab.id, message.id);
    }
    if (appleNote && editable && !alreadyEditing) {
      try {
        await beginEditing(tab.id, message, { attempts: 8, delayMs: 250 });
      } catch (error) {
        console.debug("Waiting for the Apple note message display script", error);
      }
    }
  } catch (error) {
    console.error("Could not inspect displayed message", error);
    await updateAction(tab.id, false);
  }
}

async function tryPendingAutoEdit(tabId, message) {
  const pending = pendingAutoEdit.get(tabId);
  if (
    !pending ||
    (pending.id !== message.id && pending.headerMessageId !== message.headerMessageId)
  ) {
    return false;
  }

  try {
    if (await beginEditing(tabId, message, { attempts: 24, delayMs: 250 })) {
      pendingAutoEdit.delete(tabId);
      return true;
    }
  } catch (error) {
    console.debug("Waiting for the new note's message display script", error);
  }
  return false;
}

function isSameMessage(left, right) {
  return left?.id === right?.id || Boolean(
    left?.headerMessageId && left.headerMessageId === right?.headerMessageId,
  );
}

async function beginEditing(tabId, message = null, options = {}) {
  const displayed = message || await getDisplayedMessage(tabId);
  if (!displayed) {
    return false;
  }

  const note = await getNote(displayed.id, options);
  if (!note) {
    await updateAction(tabId, false);
    return false;
  }
  if (!isAppleNoteEditable(note.full)) {
    throw new Error(text(
      "attachmentNoteReadOnly",
      "This note contains attachments or unknown MIME parts and is read-only to prevent data loss.",
    ));
  }

  const stillDisplayed = await getDisplayedMessage(tabId);
  if (!isSameMessage(displayed, stillDisplayed)) {
    return false;
  }

  await browser.tabs.sendMessage(tabId, {
    command: "notes:begin-edit",
    note: {
      isAppleNote: true,
      subject: note.parsed.subject,
    },
  });
  editingTabs.set(tabId, {
    author: note.header.author,
    folderId: note.header.folder.id,
    id: displayed.id,
    headerMessageId: displayed.headerMessageId,
    messageDate: note.header.date,
    openedAt: new Date(),
    revision: getAppleNoteRevision(note.full),
    uuid: getAppleNoteUuid(note.full),
  });
  await updateAction(tabId, true, "edit");
  return true;
}

function createRawMessage(headers, html) {
  return createRawAppleNoteMessage(headers, html);
}

function uniqueHeaders({ subject, from, createdDate = null }) {
  const uuid = crypto.randomUUID();
  const upperUuid = uuid.toUpperCase();
  const address = from || "notes@localhost";
  const domain = address.match(/@([^>\s]+)>?$/)?.[1] || "localhost";
  const now = new Date().toUTCString();

  return {
    uuid: upperUuid,
    headers: {
      from: [address],
      subject: [subject],
      date: [now],
      "x-mail-created-date": [createdDate || now],
      "x-uniform-type-identifier": [APPLE_NOTE_UTI],
      "x-universally-unique-identifier": [upperUuid],
      "message-id": [`<${uuid}@${domain}>`],
      "mime-version": ["1.0"],
    },
  };
}

async function getLocalTrashFolder() {
  const localAccount = (await browser.accounts.list(false))
    .find(account => account.type === "none");
  if (!localAccount?.rootFolder?.id) {
    throw new Error(text("noLocalAccount", "No Local Folders account was found."));
  }

  const folders = await browser.folders.getSubFolders(localAccount.rootFolder.id, false);
  let trash = folders.find(folder => folder.type === "trash")
    || folders.find(folder => folder.name.toLowerCase() === "trash");

  if (!trash) {
    trash = await browser.folders.create(localAccount.rootFolder.id, "Trash");
  }
  if (!trash?.id) {
    throw new Error(text("noLocalTrash", "The Local Folders Trash could not be opened."));
  }
  return trash;
}

async function findMovedMessage(folderId, headerMessageId, originalId) {
  for (let attempt = 0; attempt < 24; attempt++) {
    let page = await browser.messages.query({ folderId, headerMessageId });
    while (page) {
      const found = page.messages.find(message =>
        message.headerMessageId === headerMessageId && message.id !== originalId
      );
      if (found) {
        return found;
      }
      page = page.id ? await browser.messages.continueList(page.id) : null;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(text("updatedNoteNotFound", "The updated note was not found in its IMAP folder."));
}

async function replaceStoredNote(original, rawMessage) {
  const trash = await getLocalTrashFolder();
  const tempFile = new File(
    [rawMessage],
    `${crypto.randomUUID()}.eml`,
    { type: "message/rfc822" },
  );
  const imported = await browser.messages.import(tempFile, trash.id, {
    flagged: original.flagged,
    read: original.read,
    tags: original.tags,
  });

  await browser.messages.move([imported.id], original.folder.id);
  const moved = await findMovedMessage(
    original.folder.id,
    imported.headerMessageId,
    original.id,
  );

  if (await getPref("putOriginalInTrash")) {
    await browser.messages.move([original.id], trash.id);
  } else {
    await browser.messages.delete([original.id], true);
  }
  return moved;
}

async function saveNote(tabId, bodyHtml, subject) {
  const displayed = await getDisplayedMessage(tabId);
  if (!displayed) {
    throw new Error(text("noDisplayedNote", "No Apple note is currently displayed."));
  }

  const note = await getNote(displayed.id);
  if (!note) {
    throw new Error(text("noiOSNote", "This does not appear to be a valid Apple note."));
  }
  if (!isAppleNoteEditable(note.full)) {
    throw new Error(text(
      "attachmentNoteReadOnly",
      "This note contains attachments or unknown MIME parts and is read-only to prevent data loss.",
    ));
  }

  await assertNoteUnchanged(tabId, displayed, note);

  const currentUuid = note.full.headers["x-universally-unique-identifier"]?.[0];
  const identity = uniqueHeaders({
    subject,
    from: note.full.headers.from?.[0],
    createdDate: note.full.headers["x-mail-created-date"]?.[0],
  });
  const headers = structuredClone(note.full.headers);
  headers.subject = [subject];
  headers.date = [new Date().toUTCString()];
  headers["message-id"] = identity.headers["message-id"];
  headers["x-universally-unique-identifier"] = [currentUuid || identity.uuid];
  headers["x-uniform-type-identifier"] = [APPLE_NOTE_UTI];

  const html = replaceAppleNoteBody(note.parsed, bodyHtml);
  const raw = createRawMessage(headers, html);
  const updated = await replaceStoredNote(note.header, raw);

  editingTabs.delete(tabId);
  await updateAction(tabId, true);
  try {
    await browser.mailTabs.setSelectedMessages(tabId, [updated.id]);
  } catch (error) {
    console.debug("The updated note could not be selected in this tab", error);
  }
  return updated;
}

async function assertNoteUnchanged(tabId, displayed, note) {
  const editState = editingTabs.get(tabId);
  const conflictMessage = text(
    "noteChangedConflict",
    "This note changed after it was opened and was not overwritten. Close the editor and open the current version again.",
  );
  if (
    !editState ||
    !isSameMessage(editState, displayed) ||
    editState.revision !== getAppleNoteRevision(note.full)
  ) {
    throw new Error(conflictMessage);
  }

  const messageTime = new Date(editState.messageDate).getTime();
  const fromTime = Number.isFinite(messageTime)
    ? messageTime - 1_000
    : editState.openedAt.getTime() - 60_000;
  const query = {
    folderId: editState.folderId,
    fromDate: new Date(fromTime),
  };
  if (editState.author) {
    query.author = editState.author;
  }

  let page = await browser.messages.query(query);
  while (page) {
    for (const candidate of page.messages) {
      if (candidate.id === displayed.id) {
        continue;
      }
      const candidateFull = await browser.messages.getFull(candidate.id);
      if (
        isAppleNote(candidateFull) &&
        getAppleNoteUuid(candidateFull) === editState.uuid
      ) {
        throw new Error(conflictMessage);
      }
    }
    page = page.id ? await browser.messages.continueList(page.id) : null;
  }
}

async function getFolderAddress(folder) {
  try {
    const account = await browser.accounts.get(folder.accountId, false);
    return account.identities?.find(identity => identity.email)?.email || "notes@localhost";
  } catch (error) {
    console.debug("Could not resolve account identity", error);
    return "notes@localhost";
  }
}

async function resolveTargetFolder(info, tab) {
  const direct = info?.selectedFolders?.[0] || info?.displayedFolder;
  if (direct) {
    return direct;
  }
  if (tab?.id != null) {
    try {
      return (await browser.mailTabs.getSelectedFolders(tab.id))[0] || null;
    } catch (error) {
      console.debug("Could not get selected folder", error);
    }
  }
  return null;
}

async function createNote(info, tab) {
  const folder = await resolveTargetFolder(info, tab);
  if (!folder?.id || folder.isRoot || folder.isVirtual) {
    throw new Error(text("selectWritableFolder", "Select a writable mail folder for the new note."));
  }

  const subject = text("newNoteDefaultTitle", "New note");
  const from = await getFolderAddress(folder);
  const identity = uniqueHeaders({ subject, from });
  const raw = createRawMessage(identity.headers, createAppleNoteDocument(subject));
  const file = new File([raw], `${identity.uuid}.eml`, { type: "message/rfc822" });
  const created = await browser.messages.import(file, folder.id, { read: true });

  if (tab?.id != null) {
    pendingAutoEdit.set(tab.id, {
      id: created.id,
      headerMessageId: created.headerMessageId,
    });
    try {
      await browser.mailTabs.setSelectedMessages(tab.id, [created.id]);
    } catch (error) {
      pendingAutoEdit.delete(tab.id);
      console.debug("Could not select the newly created note", error);
    }
  }
  return created;
}

async function handleRuntimeMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null || !message?.command?.startsWith("notes:")) {
    return undefined;
  }

  switch (message.command) {
    case "notes:display-ready": {
      const displayed = await getDisplayedMessage(tabId);
      if (displayed) {
        await refreshDisplayedMessage(sender.tab, displayed);
      }
      return { ok: true };
    }
    case "notes:editing-started": {
      await updateAction(tabId, true, "edit");
      return { ok: true };
    }
    case "notes:editing-finished": {
      editingTabs.delete(tabId);
      const displayed = await getDisplayedMessage(tabId);
      const note = displayed && await getNote(displayed.id);
      await updateAction(
        tabId,
        Boolean(note),
        "view",
        Boolean(note && isAppleNoteEditable(note.full)),
      );
      return { ok: true };
    }
    case "notes:save":
      if (savingTabs.has(tabId)) {
        return {
          ok: false,
          error: text("saveInProgress", "This note is already being saved."),
        };
      }
      savingTabs.add(tabId);
      try {
        const updated = await saveNote(tabId, message.bodyHtml, message.subject);
        return { ok: true, messageId: updated.id };
      } catch (error) {
        console.error("Could not save Apple note", error);
        return { ok: false, error: errorMessage(error) };
      } finally {
        savingTabs.delete(tabId);
      }
    default:
      return undefined;
  }
}

browser.runtime.onMessage.addListener((message, sender) =>
  handleRuntimeMessage(message, sender)
);

browser.messageDisplay.onMessageDisplayed.addListener(refreshDisplayedMessage);

browser.messageDisplayAction.onClicked.addListener(async tab => {
  try {
    if (editingTabs.has(tab.id)) {
      await browser.tabs.sendMessage(tab.id, { command: "notes:save-request" });
    } else {
      await beginEditing(tab.id);
    }
  } catch (error) {
    await showError(error);
  }
});

browser.notesHeader.onNewNote.addListener(async tabId => {
  try {
    await createNote({}, await browser.tabs.get(tabId));
  } catch (error) {
    await showError(error);
  }
});

browser.commands.onCommand.addListener(async (command, tab) => {
  try {
    if (command === "open-ios-editor") {
      if (editingTabs.has(tab.id)) {
        await browser.tabs.sendMessage(tab.id, { command: "notes:save-request" });
      } else {
        await beginEditing(tab.id);
      }
    } else if (command === "saveclose-ios-editor" && editingTabs.has(tab.id)) {
      await browser.tabs.sendMessage(tab.id, { command: "notes:save-request" });
    } else if (command === "new-ios-note") {
      await createNote({}, tab);
    }
  } catch (error) {
    await showError(error);
  }
});

browser.menus.onShown.addListener(async (info) => {
  const message = info.selectedMessages?.messages?.length === 1
    ? info.selectedMessages.messages[0]
    : null;
  let visible = false;
  let enabled = false;
  if (message) {
    try {
      const full = await browser.messages.getFull(message.id);
      visible = isAppleNote(full);
      enabled = isAppleNoteEditable(full);
    } catch (error) {
      console.debug("Could not inspect context message", error);
    }
  }
  await browser.menus.update(EDIT_MENU_ID, { visible, enabled });
  await browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === EDIT_MENU_ID) {
      const message = info.selectedMessages?.messages?.[0];
      if (message) {
        const displayed = await getDisplayedMessage(tab.id);
        if (displayed?.id === message.id) {
          await beginEditing(tab.id, message);
        } else {
          pendingAutoEdit.set(tab.id, {
            id: message.id,
            headerMessageId: message.headerMessageId,
          });
          await browser.mailTabs.setSelectedMessages(tab.id, [message.id]);
        }
      }
    } else if (info.menuItemId === NEW_NOTE_MENU_ID) {
      await createNote(info, tab);
    }
  } catch (error) {
    await showError(error);
  }
});

async function init() {
  await browser.messageDisplayAction.disable();

  await browser.scripting.messageDisplay.registerScripts([{
    id: DISPLAY_SCRIPT_ID,
    css: ["/message-display/editor.css"],
    js: ["/message-display/editor.js"],
    runAt: "document_idle",
  }]).catch(error => {
    if (!errorMessage(error).includes("already exists")) {
      throw error;
    }
  });

  browser.menus.create({
    id: EDIT_MENU_ID,
    title: text("editNote", "Edit note"),
    contexts: ["message_list"],
    visible: false,
  });
  browser.menus.create({
    id: NEW_NOTE_MENU_ID,
    title: text("newNote", "New note"),
    contexts: ["folder_pane", "message_list"],
  });
}

init().catch(showError);
