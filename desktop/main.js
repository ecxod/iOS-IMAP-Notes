const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { updaterErrorMessage } = require("./update-utils");
const { mergeEncryptedApiKeys, publicApiKeySettings } = require("./secret-settings");
const {
  conversationMetadata,
  conversationNoteTitle,
  conversationSimilarity,
  isLikelyContinuation,
  mergeConversation,
  renderConversation,
} = require("./conversation-import");
const { commitConversationVersion, readConversationState } = require("./conversation-history");
const { fetchSharedConversation } = require("./shared-conversation-fetcher");
const {
  MAX_IMAGE_BYTES,
  MAX_NOTE_LENGTH,
  cleanTitle,
  htmlToSearchText,
  renderAppleImages,
} = require("./apple-note");
const {
  createImapNote,
  deleteImapNote,
  ensureMailbox,
  saveImapNote,
  syncAccount,
  testAccount,
} = require("./imap-service");

const SETTINGS_VERSION = 1;
const NOTES_VERSION = 2;
let operationQueue = Promise.resolve();
let notesCache = null;
let updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: "",
  percent: 0,
  error: "",
};

function publishUpdateState(changes = {}) {
  updateState = {
    ...updateState,
    ...changes,
    currentVersion: app.getVersion(),
  };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("updates:state", updateState);
  }
  return { ...updateState };
}

function updaterUnavailable() {
  return !app.isPackaged || process.platform !== "win32";
}

function configureUpdater() {
  if (updaterUnavailable()) {
    publishUpdateState({
      status: "unavailable",
      error: "",
    });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => {
    publishUpdateState({ status: "checking", error: "", percent: 0 });
  });
  autoUpdater.on("update-available", info => {
    publishUpdateState({
      status: "available",
      availableVersion: String(info.version || ""),
      error: "",
      percent: 0,
    });
  });
  autoUpdater.on("update-not-available", info => {
    publishUpdateState({
      status: "current",
      availableVersion: String(info.version || app.getVersion()),
      error: "",
      percent: 0,
    });
  });
  autoUpdater.on("download-progress", progress => {
    publishUpdateState({
      status: "downloading",
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      error: "",
    });
  });
  autoUpdater.on("update-downloaded", info => {
    publishUpdateState({
      status: "downloaded",
      availableVersion: String(info.version || updateState.availableVersion),
      percent: 100,
      error: "",
    });
  });
  autoUpdater.on("error", error => {
    publishUpdateState({
      status: "error",
      error: updaterErrorMessage(error),
    });
  });
}

async function checkForUpdates() {
  if (updaterUnavailable()) {
    return publishUpdateState({ status: "unavailable", error: "" });
  }
  if (["checking", "downloading", "installing"].includes(updateState.status)) {
    return { ...updateState };
  }
  try {
    publishUpdateState({ status: "checking", error: "", percent: 0 });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateState({ status: "error", error: updaterErrorMessage(error) });
  }
  return { ...updateState };
}

async function downloadUpdate() {
  if (updateState.status !== "available") {
    return { ...updateState };
  }
  try {
    publishUpdateState({ status: "downloading", percent: 0, error: "" });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publishUpdateState({ status: "error", error: updaterErrorMessage(error) });
  }
  return { ...updateState };
}

function installUpdate() {
  if (updateState.status !== "downloaded") {
    return { ...updateState };
  }
  const state = publishUpdateState({ status: "installing", error: "" });
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 100);
  return state;
}

function dataFile(filename) {
  return path.join(app.getPath("userData"), filename);
}

function notesFile() {
  return dataFile("notes.json");
}

function settingsFile() {
  return dataFile("settings.json");
}

function conversationHistoryRoot() {
  return dataFile("conversation-history");
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filename, value) {
  const temporary = `${filename}.tmp`;
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filename);
}

function normalizeHome(value) {
  if (value?.kind === "imap") {
    return {
      kind: "imap",
      accountId: String(value.accountId || ""),
      mailbox: String(value.mailbox || ""),
      uid: String(value.uid || ""),
      uidValidity: String(value.uidValidity || ""),
      messageId: String(value.messageId || ""),
      uuid: String(value.uuid || ""),
      revision: String(value.revision || ""),
      createdDate: String(value.createdDate || ""),
      from: String(value.from || ""),
    };
  }
  return { kind: "local" };
}

function normalizeConversationMetadata(value) {
  const provider = String(value?.provider || "").toLowerCase();
  const id = String(value?.id || "").trim();
  if (!/^[a-z0-9-]{8,80}$/i.test(id) || !["chatgpt", "gemini"].includes(provider)) {
    return null;
  }
  return {
    id,
    provider,
    shareIds: [...new Set((Array.isArray(value.shareIds) ? value.shareIds : [])
      .map(item => String(item || "").trim())
      .filter(Boolean))].slice(-50),
    latestShareUrl: String(value.latestShareUrl || ""),
    latestSourceRevision: String(value.latestSourceRevision || ""),
  };
}

function normalizeNote(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const bodyHtml = String(value.bodyHtml || "").slice(0, MAX_NOTE_LENGTH);
  const title = cleanTitle(value.title);
  const images = [];
  const contentIds = new Set();
  let imageBytes = 0;
  for (const rawImage of Array.isArray(value.images) ? value.images : []) {
    const contentId = String(rawImage?.contentId || "").trim().replace(/^<|>$/g, "");
    const contentType = String(rawImage?.contentType || "").toLowerCase();
    const filename = String(rawImage?.filename || "image").replace(/[\r\n"\\]/g, "_").slice(0, 240);
    const dataBase64 = String(rawImage?.dataBase64 || "").replace(/\s+/g, "");
    const estimatedBytes = Math.floor(dataBase64.length * 3 / 4);
    const key = contentId.toLowerCase();
    if (!contentId || /[<>\s]/.test(contentId)
        || !["image/gif", "image/jpeg", "image/png", "image/webp"].includes(contentType)
        || !dataBase64 || contentIds.has(key) || imageBytes + estimatedBytes > MAX_IMAGE_BYTES) {
      continue;
    }
    contentIds.add(key);
    imageBytes += estimatedBytes;
    images.push({ contentId, contentType, filename, dataBase64 });
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : randomUUID(),
    title,
    bodyHtml,
    searchText: String(value.searchText || `${title} ${htmlToSearchText(bodyHtml)}`).toLocaleLowerCase(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    images,
    readOnly: Boolean(value.readOnly),
    unsupportedReason: String(value.unsupportedReason || ""),
    conversation: normalizeConversationMetadata(value.conversation),
    home: normalizeHome(value.home),
  };
}

async function readNotes() {
  if (notesCache) {
    return notesCache;
  }
  const data = await readJson(notesFile(), []);
  const values = Array.isArray(data) ? data : data?.notes;
  notesCache = Array.isArray(values) ? values.map(normalizeNote).filter(Boolean) : [];
  return notesCache;
}

async function writeNotes(notes) {
  const normalized = notes.map(normalizeNote).filter(Boolean);
  await writeJson(notesFile(), {
    version: NOTES_VERSION,
    notes: normalized,
  });
  notesCache = normalized;
}

function noteSummary(note) {
  return {
    id: note.id,
    title: note.title,
    searchText: note.searchText,
    updatedAt: note.updatedAt,
    readOnly: note.readOnly,
    unsupportedReason: note.unsupportedReason,
    imageCount: note.images.length,
    conversation: note.conversation
      ? { id: note.conversation.id, provider: note.conversation.provider }
      : null,
    home: note.home,
  };
}

async function listNotes() {
  return (await readNotes()).map(noteSummary);
}

async function getNote(id) {
  return (await readNotes()).find(note => note.id === id) || null;
}

function normalizeAccount(value, { requirePassword = false } = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid account settings.");
  }
  const host = String(value.host || "").trim();
  const user = String(value.user || "").trim();
  const mailbox = String(value.mailbox || "Notes").trim() || "Notes";
  const port = Number(value.port || (value.secure === false ? 143 : 993));
  const password = String(value.password || "");
  if (!host || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Each IMAP account needs a host, valid port and username.");
  }
  if (requirePassword && !password) {
    throw new Error(`A password is required for ${user}@${host}.`);
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : randomUUID(),
    name: String(value.name || "").trim() || `${user}@${host}`,
    host,
    port,
    secure: value.secure !== false,
    user,
    mailbox,
    enabled: value.enabled !== false,
    allowInvalidCertificates: value.allowInvalidCertificates === true,
    password,
  };
}

async function readSettingsRaw() {
  const data = await readJson(settingsFile(), { version: SETTINGS_VERSION, accounts: [] });
  return {
    version: SETTINGS_VERSION,
    accounts: Array.isArray(data?.accounts) ? data.accounts : [],
    llm: data?.llm && typeof data.llm === "object" ? data.llm : {},
  };
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    host: account.host,
    port: account.port,
    secure: account.secure,
    user: account.user,
    mailbox: account.mailbox,
    enabled: account.enabled,
    allowInvalidCertificates: account.allowInvalidCertificates === true,
    hasPassword: Boolean(account.passwordCipher),
  };
}

async function encryptSecret(secret) {
  if (typeof safeStorage.encryptStringAsync === "function") {
    return (await safeStorage.encryptStringAsync(secret)).toString("base64");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is not available on this system.");
  }
  return safeStorage.encryptString(secret).toString("base64");
}

async function decryptPassword(account) {
  if (!account?.passwordCipher) {
    throw new Error(`No password is stored for ${account?.name || "this account"}.`);
  }
  const encrypted = Buffer.from(account.passwordCipher, "base64");
  if (typeof safeStorage.decryptStringAsync === "function") {
    return (await safeStorage.decryptStringAsync(encrypted)).result;
  }
  return safeStorage.decryptString(encrypted);
}

function credentialProtection() {
  if (process.platform === "win32") {
    return "Windows DPAPI";
  }
  if (typeof safeStorage.getSelectedStorageBackend !== "function") {
    return "OS credential storage";
  }
  const backend = safeStorage.getSelectedStorageBackend();
  return backend === "basic_text"
    ? "Electron's basic_text fallback (no system keyring available)"
    : backend;
}

async function listSettings() {
  const settings = await readSettingsRaw();
  return {
    accounts: settings.accounts.map(publicAccount),
    llm: publicApiKeySettings(settings),
    credentialProtection: credentialProtection(),
  };
}

async function saveSettings(input) {
  const existing = await readSettingsRaw();
  const existingById = new Map(existing.accounts.map(account => [account.id, account]));
  const accountInputs = Array.isArray(input?.accounts) ? input.accounts : [];
  const ids = new Set();
  const accounts = [];
  const mailboxesToEnsure = [];
  for (const value of accountInputs) {
    const account = normalizeAccount(value);
    if (ids.has(account.id)) {
      throw new Error("Every IMAP account must have a unique ID.");
    }
    ids.add(account.id);
    const previous = existingById.get(account.id);
    const passwordCipher = account.password
      ? await encryptSecret(account.password)
      : previous?.passwordCipher;
    if (!passwordCipher) {
      throw new Error(`Enter a password for ${account.name}.`);
    }
    if (!previous || previous.mailbox !== account.mailbox) {
      const password = account.password || (previous ? await decryptPassword(previous) : "");
      mailboxesToEnsure.push({ account, password });
    }
    delete account.password;
    accounts.push({ ...account, passwordCipher });
  }
  for (const item of mailboxesToEnsure) {
    await ensureMailbox(item.account, item.password);
  }
  const llm = await mergeEncryptedApiKeys(existing, input?.llm, encryptSecret);
  await writeJson(settingsFile(), { version: SETTINGS_VERSION, accounts, llm });
  return listSettings();
}

async function resolveAccount(accountId) {
  const settings = await readSettingsRaw();
  const account = settings.accounts.find(item => item.id === accountId);
  if (!account) {
    throw new Error("The note's IMAP home account no longer exists in Settings.");
  }
  return { account, password: await decryptPassword(account) };
}

async function testAccountSettings(input) {
  const candidate = normalizeAccount(input);
  let password = candidate.password;
  if (!password) {
    const settings = await readSettingsRaw();
    const saved = settings.accounts.find(account => account.id === candidate.id);
    password = await decryptPassword(saved);
  }
  return testAccount(candidate, password);
}

async function ensureAccountMailbox(accountId) {
  const { account, password } = await resolveAccount(accountId);
  const created = await ensureMailbox(account, password);
  return { created, mailbox: account.mailbox };
}

function serializeOperation(action) {
  const result = operationQueue.then(action, action);
  operationQueue = result.catch(() => {});
  return result;
}

async function synchronizeAll() {
  const settings = await readSettingsRaw();
  const enabled = settings.accounts.filter(account => account.enabled !== false);
  let notes = await readNotes();
  const results = await Promise.all(enabled.map(async account => {
    try {
      const password = await decryptPassword(account);
      const cachedNotes = notes.filter(note =>
        note.home.kind === "imap"
          && note.home.accountId === account.id
          && note.home.mailbox === account.mailbox
      );
      const synchronized = await syncAccount(account, password, cachedNotes);
      return { account, ...synchronized, ok: true };
    } catch (error) {
      return { account, error: error.message || String(error), ok: false };
    }
  }));

  let cacheChanged = false;
  for (const result of results) {
    if (!result.ok || !result.changed) {
      continue;
    }
    notes = notes.filter(note => note.home.kind !== "imap" || note.home.accountId !== result.account.id);
    notes.push(...result.notes);
    cacheChanged = true;
  }
  if (cacheChanged) {
    await writeNotes(notes);
  }
  return {
    results: results.map(result => ({
      accountId: result.account.id,
      accountName: result.account.name,
      count: result.notes?.length || 0,
      error: result.error || "",
      ok: result.ok,
    })),
  };
}

async function createNote(input) {
  const destination = String(input?.accountId || "local");
  let note;
  if (destination === "local") {
    note = normalizeNote({
      id: randomUUID(),
      title: cleanTitle(input?.title),
      bodyHtml: String(input?.bodyHtml || "<div><br></div>"),
      images: Array.isArray(input?.images) ? input.images : [],
      conversation: input?.conversation,
      updatedAt: Date.now(),
      home: { kind: "local" },
    });
  } else {
    const { account, password } = await resolveAccount(destination);
    note = await createImapNote(account, password, {
      title: cleanTitle(input?.title),
      bodyHtml: String(input?.bodyHtml || "<div><br></div>"),
      images: Array.isArray(input?.images) ? input.images : [],
      conversation: input?.conversation,
    });
  }
  const notes = [...await readNotes()];
  notes.unshift(note);
  await writeNotes(notes);
  return note;
}

async function saveNote(input, options = {}) {
  const notes = [...await readNotes()];
  const index = notes.findIndex(item => item.id === input?.id);
  if (index === -1) {
    throw new Error("The note is no longer present in the local cache.");
  }
  const original = notes[index];
  const changed = normalizeNote({
    ...original,
    title: cleanTitle(input.title),
    bodyHtml: String(input.bodyHtml || ""),
    images: Array.isArray(input.images) ? input.images : [],
    conversation: options.conversation === undefined
      ? original.conversation
      : options.conversation,
    searchText: "",
    updatedAt: Date.now(),
  });
  let warning = "";
  let saved = changed;
  if (original.home.kind === "imap") {
    const { account, password } = await resolveAccount(original.home.accountId);
    const result = await saveImapNote(account, password, changed);
    saved = result.note;
    warning = result.warning;
  }
  notes[index] = saved;
  await writeNotes(notes);
  if (saved.conversation && !options.skipConversationHistory) {
    try {
      const state = await readConversationState(conversationHistoryRoot(), saved.conversation.id);
      if (state?.snapshot) {
        await commitConversationVersion(conversationHistoryRoot(), {
          conversationId: saved.conversation.id,
          provider: saved.conversation.provider,
          shareIds: saved.conversation.shareIds,
          snapshot: state.snapshot,
          note: saved,
          message: `Edit ${saved.conversation.provider} conversation: ${saved.title}`,
        });
      }
    } catch (error) {
      warning = [warning, `The note was saved, but its local Git history could not be updated: ${error.message}`]
        .filter(Boolean).join("\n");
    }
  }
  return { note: saved, warning };
}

async function conversationCandidates(remote) {
  const candidates = [];
  for (const note of await readNotes()) {
    if (note.conversation?.provider !== remote.provider) {
      continue;
    }
    const exactShare = note.conversation.shareIds.includes(remote.shareId);
    const state = await readConversationState(conversationHistoryRoot(), note.conversation.id);
    if (!state?.snapshot && !exactShare) {
      continue;
    }
    const similarity = state?.snapshot
      ? conversationSimilarity(state.snapshot, remote)
      : { score: 0, commonTurns: 0, exactPrefix: false, leftTurns: 0, rightTurns: remote.turns.length };
    candidates.push({ note, state, exactShare, similarity });
  }
  return candidates.sort((left, right) => (
    Number(right.exactShare) - Number(left.exactShare)
      || right.similarity.score - left.similarity.score
      || right.similarity.commonTurns - left.similarity.commonTurns
  ));
}

async function recordImportedConversation(note, remote, message) {
  try {
    return await commitConversationVersion(conversationHistoryRoot(), {
      conversationId: note.conversation.id,
      provider: note.conversation.provider,
      shareIds: note.conversation.shareIds,
      snapshot: remote,
      note,
      message,
    });
  } catch (error) {
    return { oid: "", root: conversationHistoryRoot(), warning: error.message || String(error) };
  }
}

async function importSharedConversation(event, input) {
  const provider = String(input?.provider || "").toLowerCase();
  const remote = await fetchSharedConversation(BrowserWindow, input?.url, provider);
  const candidates = await conversationCandidates(remote);
  let candidate = candidates.find(item => item.exactShare) || null;

  if (!candidate) {
    const likely = candidates.find(item => isLikelyContinuation(item.similarity));
    if (likely) {
      const providerLabel = provider === "gemini" ? "Gemini" : "ChatGPT";
      const parent = BrowserWindow.fromWebContents(event.sender);
      const choice = await dialog.showMessageBox(parent, {
        type: "question",
        title: `${providerLabel} conversation found`,
        message: `This link looks like a continuation of “${likely.note.title}”.`,
        detail: "Update the existing note, or create a separate note? The note title is not imported or changed.",
        buttons: ["Update existing note", "Create separate note", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice.response === 2) {
        return { status: "canceled" };
      }
      if (choice.response === 0) {
        candidate = likely;
      }
    }
  }

  if (candidate && !candidate.state?.snapshot) {
    return {
      status: "conflict",
      note: noteSummary(candidate.note),
      message: "This share link already belongs to the note, but its local base version is unavailable. The note was not changed.",
    };
  }

  if (!candidate) {
    const metadata = conversationMetadata(null, remote);
    const note = await createNote({
      accountId: String(input?.accountId || "local"),
      title: conversationNoteTitle(remote),
      bodyHtml: renderConversation(remote),
      conversation: metadata,
    });
    const history = await recordImportedConversation(
      note,
      remote,
      `Import ${provider} conversation: ${note.title}`,
    );
    return { status: "created", note: noteSummary(note), history };
  }

  const merged = mergeConversation(candidate.state.snapshot, candidate.note, remote);
  if (merged.conflict) {
    return {
      status: "conflict",
      note: noteSummary(candidate.note),
      message: "The shared conversation no longer continues the stored source cleanly. The local note was not changed.",
    };
  }
  const metadata = conversationMetadata(candidate.note.conversation, remote);
  const saved = await saveNote({
    ...candidate.note,
    title: merged.title,
    bodyHtml: merged.bodyHtml,
  }, { conversation: metadata, skipConversationHistory: true });
  const history = await recordImportedConversation(
    saved.note,
    remote,
    `Update ${provider} conversation: ${saved.note.title}`,
  );
  return {
    status: "updated",
    note: noteSummary(saved.note),
    appendedTurns: merged.appendedTurns,
    warning: saved.warning,
    history,
  };
}

async function deleteNote(id) {
  const notes = await readNotes();
  const note = notes.find(item => item.id === id);
  if (!note) {
    return notes;
  }
  if (note.home.kind === "imap") {
    const { account, password } = await resolveAccount(note.home.accountId);
    await deleteImapNote(account, password, note);
  }
  const remaining = notes.filter(item => item.id !== id);
  await writeNotes(remaining);
  return remaining;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function importNote(event) {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    properties: ["openFile"],
    filters: [
      { name: "Notes", extensions: ["html", "htm", "txt"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const filename = result.filePaths[0];
  const source = (await fs.readFile(filename, "utf8")).slice(0, MAX_NOTE_LENGTH);
  const textFile = path.extname(filename).toLowerCase() === ".txt";
  return {
    title: cleanTitle(path.basename(filename, path.extname(filename))),
    bodyHtml: textFile
      ? source.split(/\r?\n/).map(line => `<div>${escapeHtml(line) || "<br>"}</div>`).join("")
      : source,
  };
}

async function exportNote(event, input) {
  const note = normalizeNote(input);
  if (!note) {
    throw new Error("Invalid note data");
  }
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath: `${note.title.replaceAll(/[\\/:*?"<>|]/g, "_")}.html`,
    filters: [{ name: "HTML note", extensions: ["html"] }],
  });
  if (result.canceled || !result.filePath) {
    return false;
  }
  const html = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(note.title)}</title>`,
    "</head><body>",
    renderAppleImages(note.bodyHtml, note.images),
    "</body></html>",
  ].join("");
  await fs.writeFile(result.filePath, html, "utf8");
  return true;
}

function assertTrustedSender(event) {
  const url = event.senderFrame?.url || "";
  if (!url.startsWith("file:") || !url.endsWith("/index.html")) {
    throw new Error("Rejected IPC request from an untrusted page.");
  }
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return callback(event, ...args);
  });
}

function registerHandlers() {
  handle("notes:list", listNotes);
  handle("notes:get", (_event, id) => getNote(id));
  handle("notes:create", (_event, input) => serializeOperation(() => createNote(input)));
  handle("notes:save", (_event, input) => serializeOperation(() => saveNote(input)));
  handle("notes:delete", (_event, id) => serializeOperation(() => deleteNote(id)));
  handle("notes:sync", () => serializeOperation(synchronizeAll));
  handle("notes:import", importNote);
  handle("notes:export", exportNote);
  handle("conversations:import", (event, input) => (
    serializeOperation(() => importSharedConversation(event, input))
  ));
  handle("clipboard:read-text", () => clipboard.readText());
  handle("editor:show-context-menu", event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const menu = Menu.buildFromTemplate([
      { label: "Paste", role: "paste" },
      {
        label: "Paste Plain Text",
        click: () => event.sender.send("editor:paste-plain-text"),
      },
    ]);
    menu.popup({ window });
    return true;
  });
  handle("settings:list", listSettings);
  handle("settings:save", (_event, input) => serializeOperation(() => saveSettings(input)));
  handle("settings:test", (_event, input) => testAccountSettings(input));
  handle("settings:ensure-mailbox", (_event, accountId) => (
    serializeOperation(() => ensureAccountMailbox(accountId))
  ));
  handle("updates:get-state", () => ({ ...updateState }));
  handle("updates:check", checkForUpdates);
  handle("updates:download", downloadUpdate);
  handle("updates:install", installUpdate);
  ipcMain.on("app:close-window", event => {
    assertTrustedSender(event);
    BrowserWindow.fromWebContents(event.sender)?.destroy();
  });
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    title: "iOS IMAP Notes Offline",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  await window.loadFile("index.html");
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configureUpdater();
  registerHandlers();
  await createWindow();
  if (!updaterUnavailable()) {
    setTimeout(checkForUpdates, 2500);
  }
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
