import { getPref } from "./options/defaults.mjs";
import {
  APPLE_NOTE_UTI,
  createAppleNoteDocument,
  isAppleNote,
  parseAppleNote,
  replaceAppleNoteBody,
} from "./scripts/apple-note.mjs";

const EDIT_MENU_ID = "iosNotesEdit";
const NEW_NOTE_MENU_ID = "iosNotesNew";
const DISPLAY_SCRIPT_ID = "ios-imap-notes-message-editor";
const editingTabs = new Set();
const pendingAutoEdit = new Map();

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

async function getNote(messageId) {
  const full = await browser.messages.getFull(messageId);
  const parsed = parseAppleNote(full);
  if (!parsed) {
    return null;
  }
  return {
    full,
    parsed,
    header: await browser.messages.get(messageId),
  };
}

async function updateAction(tabId, appleNote, mode = "view") {
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
  await browser.messageDisplayAction.enable(tabId);
}

async function refreshDisplayedMessage(tab, message) {
  if (!message) {
    await updateAction(tab.id, false);
    return;
  }

  try {
    const full = await browser.messages.getFull(message.id);
    const appleNote = isAppleNote(full);
    editingTabs.delete(tab.id);
    await updateAction(tab.id, appleNote);
    await tryPendingAutoEdit(tab.id, message);
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
    if (await beginEditing(tabId, message)) {
      pendingAutoEdit.delete(tabId);
      return true;
    }
  } catch (error) {
    console.debug("Waiting for the new note's message display script", error);
  }
  return false;
}

async function beginEditing(tabId, message = null) {
  const displayed = message || await getDisplayedMessage(tabId);
  if (!displayed) {
    return false;
  }

  const note = await getNote(displayed.id);
  if (!note) {
    await updateAction(tabId, false);
    return false;
  }

  await browser.tabs.sendMessage(tabId, {
    command: "notes:begin-edit",
    note: {
      isAppleNote: true,
      subject: note.parsed.subject,
    },
  });
  editingTabs.add(tabId);
  await updateAction(tabId, true, "edit");
  return true;
}

function mailbox(value) {
  try {
    return new globalThis.MimeText.Mailbox(value);
  } catch (error) {
    console.debug("Could not parse From header", value, error);
    return value;
  }
}

function createRawMessage(headers, html) {
  const message = globalThis.MimeText.createMimeMessage();
  const generatedHeaders = new Set([
    "content-type",
    "content-transfer-encoding",
    "x-mozilla-keys",
    "x-mozilla-status",
    "x-mozilla-status2",
  ]);

  for (const [name, values] of Object.entries(headers)) {
    if (generatedHeaders.has(name.toLowerCase())) {
      continue;
    }
    let value = Array.isArray(values) ? values[0] : values;
    if (value == null || value === "") {
      continue;
    }
    if (name.toLowerCase() === "from") {
      value = mailbox(value);
    }
    message.setHeader(name, value);
  }

  message.addMessage({
    contentType: "text/html",
    encoding: "8bit",
    data: html,
  });
  return message.asRaw();
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
    case "notes:editing-started":
      editingTabs.add(tabId);
      await updateAction(tabId, true, "edit");
      return { ok: true };
    case "notes:editing-finished": {
      editingTabs.delete(tabId);
      const displayed = await getDisplayedMessage(tabId);
      await updateAction(tabId, Boolean(displayed && await getNote(displayed.id)));
      return { ok: true };
    }
    case "notes:save":
      try {
        const updated = await saveNote(tabId, message.bodyHtml, message.subject);
        return { ok: true, messageId: updated.id };
      } catch (error) {
        console.error("Could not save Apple note", error);
        return { ok: false, error: errorMessage(error) };
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
  if (message) {
    try {
      visible = isAppleNote(await browser.messages.getFull(message.id));
    } catch (error) {
      console.debug("Could not inspect context message", error);
    }
  }
  await browser.menus.update(EDIT_MENU_ID, { visible });
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
    title: text("newNote", "New Apple note"),
    contexts: ["folder_pane", "message_list"],
  });
}

init().catch(showError);
