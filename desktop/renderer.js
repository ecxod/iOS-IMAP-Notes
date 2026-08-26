/* global SUNEDITOR */

let notes = [];
let accounts = [];
let selected = null;
let editor = null;
let dirty = false;
let suppressChanges = false;
let pendingCreateInput = null;

const searchHighlightName = "note-search-results";

const list = document.getElementById("note-list");
const title = document.getElementById("note-title");
const saveState = document.getElementById("save-state");
const syncState = document.getElementById("sync-state");
const emptyState = document.getElementById("empty-state");
const editorArea = document.getElementById("editor-area");
const saveButton = document.getElementById("save-note");
const deleteButton = document.getElementById("delete-note");
const exportButton = document.getElementById("export-note");
const searchInput = document.getElementById("note-search");
const accountFilter = document.getElementById("account-filter");
const noteHome = document.getElementById("note-home");
const newNoteDialog = document.getElementById("new-note-dialog");
const newNoteHome = document.getElementById("new-note-home");
const newNoteFolder = document.getElementById("new-note-folder");
const settingsDialog = document.getElementById("settings-dialog");
const settingsState = document.getElementById("settings-state");
const accountList = document.getElementById("account-list");
const appVersion = document.getElementById("app-version");
const updateStateText = document.getElementById("update-state");
const checkUpdatesButton = document.getElementById("check-updates");
const updateAppButton = document.getElementById("update-app");
let currentUpdateState = null;

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content
    .querySelectorAll("script, iframe, frame, object, embed, form, base, meta, link")
    .forEach(element => element.remove());
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || (['href', 'src', 'xlink:href'].includes(name) && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.innerHTML;
}

function clearSearchHighlights() {
  if (globalThis.CSS?.highlights) {
    CSS.highlights.delete(searchHighlightName);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateSearchHighlights() {
  clearSearchHighlights();
  const query = searchInput.value.trim();
  if (!query || !selected || editorArea.hidden || !globalThis.CSS?.highlights || typeof Highlight !== "function") {
    return;
  }

  const editorBody = editorArea.querySelector(".se-wrapper-wysiwyg");
  if (!editorBody) {
    return;
  }

  const ranges = [];
  const matcher = new RegExp(escapeRegExp(query), "giu");
  const walker = document.createTreeWalker(editorBody, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of node.nodeValue.matchAll(matcher)) {
      const range = new Range();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
    }
  }

  if (ranges.length) {
    CSS.highlights.set(searchHighlightName, new Highlight(...ranges));
  }
}

function errorText(error) {
  return error?.message || String(error);
}

function renderUpdateState(state) {
  currentUpdateState = state;
  appVersion.textContent = `Version ${state.currentVersion}`;
  checkUpdatesButton.disabled = ["checking", "downloading", "installing"].includes(state.status);
  updateAppButton.hidden = !["available", "downloading", "downloaded", "installing"].includes(state.status);
  updateAppButton.disabled = ["downloading", "installing"].includes(state.status);

  const version = state.availableVersion ? ` ${state.availableVersion}` : "";
  switch (state.status) {
    case "checking":
      updateStateText.textContent = "Checking for updates…";
      break;
    case "current":
      updateStateText.textContent = "Up to date";
      break;
    case "available":
      updateStateText.textContent = `Update${version} is available`;
      updateAppButton.textContent = "Download update";
      break;
    case "downloading":
      updateStateText.textContent = `Downloading update${version} — ${Math.round(state.percent)}%`;
      updateAppButton.textContent = "Downloading…";
      break;
    case "downloaded":
      updateStateText.textContent = `Update${version} is ready`;
      updateAppButton.textContent = "Install update";
      break;
    case "installing":
      updateStateText.textContent = "Installing update and restarting…";
      updateAppButton.textContent = "Installing…";
      break;
    case "error":
      updateStateText.textContent = `Update failed: ${state.error}`;
      break;
    case "unavailable":
      updateStateText.textContent = "Update checks are available in the installed Windows app";
      break;
    default:
      updateStateText.textContent = "Updates not checked";
  }
}

async function useUpdateButton() {
  if (currentUpdateState?.status === "available") {
    await window.notesApi.updates.download();
    return;
  }
  if (currentUpdateState?.status === "downloaded"
      && canLeaveCurrentNote()
      && window.confirm(`Install version ${currentUpdateState.availableVersion} and restart the app?`)) {
    await window.notesApi.updates.install();
  }
}

async function initializeUpdates() {
  window.notesApi.updates.onStateChange(renderUpdateState);
  renderUpdateState(await window.notesApi.updates.getState());
}

function accountForNote(note) {
  return note?.home?.kind === "imap"
    ? accounts.find(account => account.id === note.home.accountId)
    : null;
}

function homeLabel(note) {
  if (note?.home?.kind !== "imap") {
    return "Local";
  }
  const account = accountForNote(note);
  return `${account?.name || "Unknown account"} · ${note.home.mailbox}`;
}

function setDirty(value) {
  dirty = value;
  saveState.textContent = value ? "Unsaved" : selected ? "Saved" : "";
  saveButton.disabled = !selected || !value;
}

function canLeaveCurrentNote() {
  return !dirty || window.confirm("Discard unsaved changes?");
}

function currentNoteData() {
  if (!selected) {
    return null;
  }
  return {
    id: selected.id,
    title: title.value.trim() || "New note",
    bodyHtml: sanitizeHtml(editor.getContents()),
  };
}

function visibleNotes() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filter = accountFilter.value;
  return notes.filter(note => {
    if (filter === "local" && note.home.kind !== "local") {
      return false;
    }
    if (filter !== "all" && filter !== "local" && note.home.accountId !== filter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return `${note.searchText || ""} ${homeLabel(note)}`.toLocaleLowerCase().includes(query);
  });
}

function renderList() {
  list.replaceChildren();
  for (const note of visibleNotes()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = note.id;
    button.setAttribute("aria-current", String(note.id === selected?.id));

    const noteTitle = document.createElement("span");
    noteTitle.className = "note-list-title";
    noteTitle.textContent = note.title;

    const details = document.createElement("span");
    details.className = "note-list-details";
    const home = document.createElement("span");
    home.className = "note-list-home";
    home.textContent = homeLabel(note);
    const date = document.createElement("span");
    date.className = "note-list-date";
    date.textContent = new Date(note.updatedAt).toLocaleString();
    details.append(home, date);

    button.append(noteTitle, details);
    button.addEventListener("click", () => selectNote(note.id));
    item.append(button);
    list.append(item);
  }

  if (!list.childElementCount) {
    const message = document.createElement("li");
    message.className = "no-results";
    message.textContent = searchInput.value ? "No matching notes" : "No notes in this view";
    list.append(message);
  }
}

function showSelectedNote(note) {
  selected = note;
  suppressChanges = true;
  title.value = note.title;
  editor.setContents(sanitizeHtml(note.bodyHtml));
  suppressChanges = false;
  noteHome.textContent = homeLabel(note);
  noteHome.title = note.home.kind === "imap"
    ? `Changes are saved to ${homeLabel(note)}`
    : "Stored only on this computer";
  emptyState.hidden = true;
  editorArea.hidden = false;
  title.disabled = false;
  deleteButton.disabled = false;
  exportButton.disabled = false;
  setDirty(false);
  renderList();
  updateSearchHighlights();
}

function showEmptyState() {
  clearSearchHighlights();
  selected = null;
  title.value = "";
  title.disabled = true;
  noteHome.textContent = "";
  deleteButton.disabled = true;
  exportButton.disabled = true;
  emptyState.hidden = false;
  editorArea.hidden = true;
  setDirty(false);
  renderList();
}

function selectNote(id) {
  if (id === selected?.id || !canLeaveCurrentNote()) {
    return;
  }
  const note = notes.find(item => item.id === id);
  if (note) {
    showSelectedNote(note);
  }
}

async function reloadNotes(preferredId = selected?.id) {
  notes = (await window.notesApi.list()).sort((a, b) => b.updatedAt - a.updatedAt);
  const note = notes.find(item => item.id === preferredId) || notes[0];
  if (note) {
    showSelectedNote(note);
  } else {
    showEmptyState();
  }
}

function renderAccountChoices() {
  const currentFilter = accountFilter.value;
  accountFilter.replaceChildren(
    new Option("All accounts", "all"),
    new Option("Local notes", "local"),
  );
  newNoteHome.replaceChildren(new Option("Local notes", "local"));
  for (const account of accounts) {
    accountFilter.add(new Option(account.name, account.id));
    if (account.enabled) {
      newNoteHome.add(new Option(`${account.name} — ${account.mailbox}`, account.id));
    }
  }
  accountFilter.value = [...accountFilter.options].some(option => option.value === currentFilter)
    ? currentFilter
    : "all";
}

async function loadSettings() {
  const settings = await window.notesApi.settings.list();
  accounts = settings.accounts;
  document.getElementById("credential-protection").textContent = settings.credentialProtection;
  renderAccountChoices();
  renderList();
  return settings;
}

function updateNewNoteFolder() {
  const account = accounts.find(item => item.id === newNoteHome.value);
  newNoteFolder.textContent = account
    ? `This note will always save back to ${account.name}, folder “${account.mailbox}”.`
    : "This note will be stored only on this computer.";
}

function openNewNoteDialog(input = null) {
  if (!canLeaveCurrentNote()) {
    return;
  }
  pendingCreateInput = input;
  const filter = accountFilter.value;
  const defaultAccount = accounts.find(account => account.id === filter && account.enabled)
    || accounts.find(account => account.id === selected?.home?.accountId && account.enabled)
    || accounts.filter(account => account.enabled).length === 1 && accounts.find(account => account.enabled);
  newNoteHome.value = defaultAccount?.id || "local";
  updateNewNoteFolder();
  newNoteDialog.showModal();
}

async function completeCreateNote() {
  const note = await window.notesApi.create({
    accountId: newNoteHome.value,
    title: pendingCreateInput?.title || "New note",
    bodyHtml: sanitizeHtml(pendingCreateInput?.bodyHtml || "<div><br></div>"),
  });
  pendingCreateInput = null;
  await reloadNotes(note.id);
  syncState.textContent = `Created in ${homeLabel(note)}`;
  title.focus();
  title.select();
}

async function saveNote() {
  const note = currentNoteData();
  if (!note) {
    return;
  }
  saveButton.disabled = true;
  saveState.textContent = selected.home?.kind === "imap" ? "Saving to IMAP…" : "Saving…";
  try {
    const result = await window.notesApi.save(note);
    await reloadNotes(result.note.id);
    if (result.warning) {
      saveState.textContent = "Saved with warning";
      window.alert(result.warning);
    }
  } catch (error) {
    saveState.textContent = errorText(error);
    saveButton.disabled = false;
  }
}

async function deleteNote() {
  if (!selected || !window.confirm(`Are you sure you want to delete “${selected.title}” from ${homeLabel(selected)}?`)) {
    return;
  }
  try {
    await window.notesApi.delete(selected.id);
    selected = null;
    await reloadNotes();
  } catch (error) {
    saveState.textContent = errorText(error);
  }
}

async function importNote() {
  if (!canLeaveCurrentNote()) {
    return;
  }
  const imported = await window.notesApi.import();
  if (imported) {
    openNewNoteDialog(imported);
  }
}

async function exportNote() {
  const note = currentNoteData();
  if (note) {
    await window.notesApi.export(note);
  }
}

async function syncNotes() {
  if (!canLeaveCurrentNote()) {
    return;
  }
  syncState.textContent = "Synchronizing…";
  document.getElementById("sync-notes").disabled = true;
  try {
    const result = await window.notesApi.sync();
    const errors = result.results.filter(item => !item.ok);
    const count = result.results.reduce((total, item) => total + item.count, 0);
    syncState.textContent = errors.length
      ? `${errors.length} account error: ${errors.map(item => `${item.accountName}: ${item.error}`).join("; ")}`
      : `${count} IMAP notes synchronized`;
    await reloadNotes();
  } catch (error) {
    syncState.textContent = errorText(error);
  } finally {
    document.getElementById("sync-notes").disabled = false;
  }
}

function accountInput(card, field) {
  return card.querySelector(`[data-field="${field}"]`);
}

function collectAccount(card) {
  return {
    id: card.dataset.id,
    name: accountInput(card, "name").value,
    host: accountInput(card, "host").value,
    port: Number(accountInput(card, "port").value),
    user: accountInput(card, "user").value,
    password: accountInput(card, "password").value,
    mailbox: accountInput(card, "mailbox").value,
    enabled: accountInput(card, "enabled").checked,
    secure: accountInput(card, "secure").checked,
    allowInvalidCertificates: accountInput(card, "allowInvalidCertificates").checked,
  };
}

async function testAccountCard(card) {
  const button = card.querySelector('[data-action="test"]');
  const state = accountInput(card, "testState");
  const discovered = accountInput(card, "discoveredMailbox");
  button.disabled = true;
  state.textContent = "Connecting…";
  try {
    const mailboxes = await window.notesApi.settings.test(collectAccount(card));
    discovered.replaceChildren(
      new Option("Choose discovered folder…", ""),
      ...mailboxes.map(mailbox => new Option(mailbox, mailbox)),
    );
    discovered.hidden = false;
    state.textContent = `Connected — ${mailboxes.length} folders found`;
  } catch (error) {
    state.textContent = errorText(error);
  } finally {
    button.disabled = false;
  }
}

function addAccountCard(account = {}) {
  const card = document.getElementById("account-template").content.firstElementChild.cloneNode(true);
  card.dataset.id = account.id || crypto.randomUUID();
  for (const field of ["name", "host", "user", "mailbox"]) {
    if (account[field] != null) {
      accountInput(card, field).value = account[field];
    }
  }
  accountInput(card, "port").value = account.port || 993;
  accountInput(card, "enabled").checked = account.enabled !== false;
  accountInput(card, "secure").checked = account.secure !== false;
  accountInput(card, "allowInvalidCertificates").checked = account.allowInvalidCertificates === true;
  if (account.hasPassword) {
    accountInput(card, "password").placeholder = "Stored — leave blank to keep";
  }

  card.querySelector('[data-action="remove"]').addEventListener("click", () => card.remove());
  card.querySelector('[data-action="test"]').addEventListener("click", () => testAccountCard(card));
  accountInput(card, "discoveredMailbox").addEventListener("change", event => {
    if (event.target.value) {
      accountInput(card, "mailbox").value = event.target.value;
    }
  });
  accountInput(card, "secure").addEventListener("change", event => {
    const port = accountInput(card, "port");
    if (["143", "993"].includes(port.value)) {
      port.value = event.target.checked ? "993" : "143";
    }
  });
  accountList.append(card);
}

async function openSettings() {
  const settings = await loadSettings();
  settingsState.textContent = "";
  accountList.replaceChildren();
  for (const account of settings.accounts) {
    addAccountCard(account);
  }
  settingsDialog.showModal();
}

async function saveSettings() {
  const form = document.getElementById("settings-form");
  if (!form.reportValidity()) {
    return;
  }
  settingsState.textContent = "Encrypting and saving…";
  try {
    const accountValues = [...accountList.querySelectorAll(".account-card")].map(collectAccount);
    await window.notesApi.settings.save({ accounts: accountValues });
    await loadSettings();
    settingsDialog.close("save");
    await syncNotes();
  } catch (error) {
    settingsState.textContent = errorText(error);
  }
}

async function init() {
  editor = SUNEDITOR.create("editor", {
    height: "100%",
    minHeight: "240px",
    resizingBar: false,
    showPathLabel: false,
    buttonList: [
      ["undo", "redo"],
      ["formatBlock", "fontSize"],
      ["bold", "underline", "italic", "strike"],
      ["fontColor", "hiliteColor"],
      ["align", "list", "outdent", "indent"],
      ["link", "table", "horizontalRule"],
      ["removeFormat", "codeView", "fullScreen"],
    ],
    callBackSave: saveNote,
  });
  editor.onChange = () => {
    if (!suppressChanges && selected) {
      setDirty(true);
    }
    updateSearchHighlights();
  };

  document.getElementById("new-note").addEventListener("click", () => openNewNoteDialog());
  document.getElementById("import-note").addEventListener("click", importNote);
  document.getElementById("sync-notes").addEventListener("click", syncNotes);
  document.getElementById("open-settings").addEventListener("click", openSettings);
  checkUpdatesButton.addEventListener("click", () => window.notesApi.updates.check());
  updateAppButton.addEventListener("click", useUpdateButton);
  document.getElementById("add-account").addEventListener("click", () => addAccountCard());
  saveButton.addEventListener("click", saveNote);
  deleteButton.addEventListener("click", deleteNote);
  exportButton.addEventListener("click", exportNote);
  title.addEventListener("input", () => selected && setDirty(true));
  searchInput.addEventListener("input", () => {
    renderList();
    updateSearchHighlights();
  });
  accountFilter.addEventListener("change", renderList);
  newNoteHome.addEventListener("change", updateNewNoteFolder);
  document.getElementById("new-note-form").addEventListener("submit", event => {
    if (event.submitter?.value !== "create") {
      pendingCreateInput = null;
      return;
    }
    event.preventDefault();
    completeCreateNote()
      .then(() => newNoteDialog.close("create"))
      .catch(error => { newNoteFolder.textContent = errorText(error); });
  });
  document.getElementById("settings-form").addEventListener("submit", event => {
    if (event.submitter?.value !== "save") {
      return;
    }
    event.preventDefault();
    saveSettings();
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveNote();
    }
  });
  window.addEventListener("beforeunload", event => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  await initializeUpdates();
  await loadSettings();
  await reloadNotes();
  if (accounts.some(account => account.enabled)) {
    await syncNotes();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch(error => { syncState.textContent = errorText(error); });
});
