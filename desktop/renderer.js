/* global NoteEditorHtml, NoteImages, NotePaste, NoteSearch, NoteTabs, SUNEDITOR */

let notes = [];
let accounts = [];
let selected = null;
let openTabs = [];
let activeTabId = null;
let editor = null;
let dirty = false;
let suppressChanges = false;
let pendingCreateInput = null;
let loadedImageMetadata = [];
let availableAiProviders = [];
let editorInsertionRange = null;
const managedImageUrls = new Set();
let selectionRequest = 0;
let searchHighlightTimer = null;

const searchHighlightName = "note-search-results";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const DATA_IMAGE_PATTERN = /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i;
const CONTENT_ID_PATTERN = /^[^<>\s\r\n]+$/;

const list = document.getElementById("note-list");
const tabList = document.getElementById("note-tabs");
const title = document.getElementById("note-title");
const saveState = document.getElementById("save-state");
const syncState = document.getElementById("sync-state");
const emptyState = document.getElementById("empty-state");
const emptyStateTitle = document.getElementById("empty-state-title");
const emptyStateCopy = document.getElementById("empty-state-copy");
const editorArea = document.getElementById("editor-area");
const aiCompose = document.getElementById("ai-compose");
const aiProvider = document.getElementById("ai-provider");
const aiPrompt = document.getElementById("ai-prompt");
const aiSubmit = document.getElementById("ai-submit");
const aiState = document.getElementById("ai-state");
const saveButton = document.getElementById("save-note");
const deleteButton = document.getElementById("delete-note");
const exportButton = document.getElementById("export-note");
const searchInput = document.getElementById("note-search");
const accountFilter = document.getElementById("account-filter");
const noteHome = document.getElementById("note-home");
const newNoteDialog = document.getElementById("new-note-dialog");
const newNoteHome = document.getElementById("new-note-home");
const newNoteFolder = document.getElementById("new-note-folder");
const newNoteShareLink = document.getElementById("new-note-share-link");
const newNoteState = document.getElementById("new-note-state");
const importConversationLinkButton = document.getElementById("import-conversation-link");
const settingsDialog = document.getElementById("settings-dialog");
const settingsState = document.getElementById("settings-state");
const accountList = document.getElementById("account-list");
const openAiApiKey = document.getElementById("openai-api-key");
const sentryDsn = document.getElementById("sentry-dsn");
const geminiApiKey = document.getElementById("gemini-api-key");
const appVersion = document.getElementById("app-version");
const updateStateText = document.getElementById("update-state");
const checkUpdatesButton = document.getElementById("check-updates");
const updateAppButton = document.getElementById("update-app");
const closeAppButton = document.getElementById("close-app");
let currentUpdateState = null;

function sanitizeHtml(html, preserveAppleObjects = false) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content
    .querySelectorAll("script, iframe, frame, embed, form, base, meta, link")
    .forEach(element => element.remove());
  for (const object of template.content.querySelectorAll("object")) {
    const data = object.getAttribute("data") || "";
    if (!preserveAppleObjects
        || object.getAttribute("type")?.toLowerCase() !== "application/x-apple-msg-attachment"
        || !data.startsWith("cid:")
        || !CONTENT_ID_PATTERN.test(data.slice(4))) {
      object.remove();
    } else {
      for (const attribute of [...object.attributes]) {
        if (!["type", "data"].includes(attribute.name.toLowerCase())) {
          object.removeAttribute(attribute.name);
        }
      }
    }
  }
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || (['href', 'src', 'xlink:href'].includes(name) && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "IMG"
        && !DATA_IMAGE_PATTERN.test(element.getAttribute("src") || "")
        && !managedImageUrls.has(element.getAttribute("src") || "")) {
      element.remove();
    }
  }
  return template.innerHTML;
}

function cleanContentId(value) {
  const contentId = String(value || "").trim().replace(/^<|>$/g, "");
  return CONTENT_ID_PATTERN.test(contentId) ? contentId : "";
}

function cidContentId(value) {
  const raw = String(value || "").replace(/^cid:/i, "");
  try {
    return cleanContentId(decodeURIComponent(raw));
  } catch {
    return cleanContentId(raw);
  }
}

function imageMap(note) {
  return new Map((Array.isArray(note?.images) ? note.images : []).map(image => [
    cleanContentId(image.contentId).toLowerCase(),
    image,
  ]));
}

function clearManagedImageUrls() {
  for (const url of managedImageUrls) {
    URL.revokeObjectURL(url);
  }
  managedImageUrls.clear();
}

function imageBlobUrl(image) {
  const binary = atob(image.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: image.contentType }));
  managedImageUrls.add(url);
  return { url, byteLength: bytes.length };
}

function editorHtmlForNote(note) {
  const template = document.createElement("template");
  template.innerHTML = String(note?.bodyHtml || "");
  const images = imageMap(note);
  clearManagedImageUrls();
  loadedImageMetadata = [];
  for (const element of template.content.querySelectorAll("object, img[src]")) {
    const isObject = element.tagName === "OBJECT";
    const reference = isObject ? element.getAttribute("data") : element.getAttribute("src");
    const contentId = String(reference || "").toLowerCase().startsWith("cid:")
      ? cidContentId(reference)
      : "";
    const image = images.get(contentId.toLowerCase());
    if ((isObject
      && element.getAttribute("type")?.toLowerCase() !== "application/x-apple-msg-attachment")
      || !image) {
      continue;
    }
    const img = isObject ? document.createElement("img") : element;
    const blob = imageBlobUrl(image);
    img.src = blob.url;
    img.alt = image.filename || "Image";
    img.dataset.appleContentId = image.contentId;
    img.dataset.appleContentType = image.contentType;
    img.dataset.appleFilename = image.filename || "image";
    img.dataset.fileName = image.filename || "image";
    img.dataset.fileSize = String(Math.floor(image.dataBase64.length * 3 / 4));
    loadedImageMetadata.push({
      src: img.src,
      contentId: image.contentId,
      contentType: image.contentType,
      filename: image.filename || "image",
      dataBase64: image.dataBase64,
      byteLength: blob.byteLength,
    });
    if (isObject) {
      element.replaceWith(img);
    }
  }
  return NoteEditorHtml.normalizeForSunEditor(sanitizeHtml(template.innerHTML));
}

function downscaledOriginalImage(original, liveImage) {
  const target = NoteImages.downscaleTarget({
    originSize: liveImage?.getAttribute("data-origin"),
    currentSize: liveImage?.getAttribute("data-size"),
    naturalWidth: liveImage?.naturalWidth,
    naturalHeight: liveImage?.naturalHeight,
    displayWidth: liveImage?.getBoundingClientRect().width,
    displayHeight: liveImage?.getBoundingClientRect().height,
  });
  if (!target) {
    return original;
  }
  if (original.contentType === "image/gif") {
    throw new Error("GIF images cannot be resized safely because that would remove their animation.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(liveImage, 0, 0, target.width, target.height);
  const quality = ["image/jpeg", "image/webp"].includes(original.contentType) ? 0.92 : undefined;
  const dataUrl = canvas.toDataURL(original.contentType, quality);
  const prefix = `data:${original.contentType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new Error(`The resized ${original.contentType} image could not be encoded.`);
  }
  const dataBase64 = dataUrl.slice(prefix.length);
  return {
    ...original,
    dataBase64,
    byteLength: atob(dataBase64).length,
  };
}

function dataImage(image, originalImages, liveImages) {
  const src = String(image.getAttribute("src") || "");
  const original = originalImages.find(value => value.src === src) || null;
  if (original) {
    const resized = downscaledOriginalImage(original, liveImages.get(src));
    return {
      contentId: cleanContentId(image.dataset.appleContentId || resized.contentId)
        || `${crypto.randomUUID().toUpperCase()}@mobilenotes.apple.com`,
      contentType: resized.contentType,
      filename: String(
        image.dataset.appleFilename || resized.filename || image.dataset.fileName || "image",
      ).replace(/[\r\n"\\]/g, "_").slice(0, 240),
      dataBase64: resized.dataBase64,
      byteLength: resized.byteLength,
    };
  }
  const match = src.match(DATA_IMAGE_PATTERN);
  if (!match) {
    throw new Error("Only local JPEG, PNG, GIF or WebP images can be saved.");
  }
  const contentType = match[1].toLowerCase();
  const dataBase64 = match[2].replace(/\s+/g, "");
  let byteLength;
  try {
    byteLength = atob(dataBase64).length;
  } catch {
    throw new Error("An inserted image contains invalid data.");
  }
  if (!byteLength) {
    throw new Error("An inserted image is empty.");
  }
  const extension = contentType === "image/jpeg" ? "jpg" : contentType.slice(6);
  const contentId = cleanContentId(image.dataset.appleContentId)
    || `${crypto.randomUUID().toUpperCase()}@mobilenotes.apple.com`;
  const filename = String(
    image.dataset.appleFilename || image.dataset.fileName || `image.${extension}`,
  ).replace(/[\r\n"\\]/g, "_").slice(0, 240);
  return { contentId, contentType, filename, dataBase64, byteLength };
}

function collectEditorNote() {
  const liveImages = new Map([...editorArea.querySelectorAll(".sun-editor-editable img")]
    .map(image => [String(image.getAttribute("src") || ""), image]));
  const template = document.createElement("template");
  template.innerHTML = String(editor.getContents() || "");
  const images = new Map();
  const originalImages = loadedImageMetadata.map(image => ({ ...image }));
  let totalBytes = 0;
  for (const element of template.content.querySelectorAll("img")) {
    const image = dataImage(element, originalImages, liveImages);
    const key = image.contentId.toLowerCase();
    const previous = images.get(key);
    if (previous && (previous.contentType !== image.contentType || previous.dataBase64 !== image.dataBase64)) {
      throw new Error("Two different images use the same internal Content-ID.");
    }
    if (!previous) {
      totalBytes += image.byteLength;
      images.set(key, image);
    }
    const object = document.createElement("object");
    object.setAttribute("type", "application/x-apple-msg-attachment");
    object.setAttribute("data", `cid:${image.contentId}`);
    element.replaceWith(object);
  }
  if (totalBytes > MAX_IMAGE_BYTES) {
    throw new Error("Images may use at most 6 MB in total.");
  }
  return {
    bodyHtml: sanitizeHtml(template.innerHTML, true),
    images: [...images.values()].map(({ byteLength: _byteLength, ...image }) => image),
  };
}

function clearSearchHighlights() {
  if (globalThis.CSS?.highlights) {
    CSS.highlights.delete(searchHighlightName);
  }
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

  const textNodes = [];
  const walker = document.createTreeWalker(editorBody, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node);
  }

  const ranges = NoteSearch.findSearchMatches(textNodes.map(node => node.nodeValue), query).map(match => {
    const range = new Range();
    range.setStart(textNodes[match.startPart], match.startOffset);
    range.setEnd(textNodes[match.endPart], match.endOffset);
    return range;
  });

  if (ranges.length) {
    CSS.highlights.set(searchHighlightName, new Highlight(...ranges));
  }
}

function scheduleSearchHighlights() {
  if (searchHighlightTimer !== null) {
    clearTimeout(searchHighlightTimer);
  }
  searchHighlightTimer = setTimeout(() => {
    searchHighlightTimer = null;
    updateSearchHighlights();
  }, 80);
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
    for (const tab of openTabs) {
      tab.dirty = false;
    }
    dirty = false;
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

function activeTab() {
  return openTabs.find(tab => tab.id === activeTabId) || null;
}

function scopeLabel(scope) {
  if (scope === "local") {
    return "Local notes";
  }
  const account = accounts.find(item => item.id === scope);
  return account ? `${account.name} · ${account.mailbox}` : "Unknown account";
}

function tabLabel(tab) {
  if (!tab.noteId) {
    return `${scopeLabel(tab.scope)} — Empty`;
  }
  if (tab.id === activeTabId && selected) {
    return title.value.trim() || "New note";
  }
  return tab.note?.title || "New note";
}

function renderTabs() {
  tabList.replaceChildren();
  tabList.hidden = openTabs.length === 0;
  for (const tab of openTabs) {
    const item = document.createElement("div");
    item.className = "note-tab";
    item.setAttribute("aria-current", String(tab.id === activeTabId));

    const select = document.createElement("button");
    select.type = "button";
    select.className = "note-tab-select";
    select.id = `note-tab-${tab.id}`;
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(tab.id === activeTabId));
    select.title = tabLabel(tab);
    select.append(tabLabel(tab));
    if (tab.dirty) {
      const marker = document.createElement("span");
      marker.className = "note-tab-dirty";
      marker.textContent = " •";
      marker.setAttribute("aria-label", "Unsaved changes");
      select.append(marker);
    }
    select.addEventListener("click", () => activateTab(tab.id));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "note-tab-close";
    close.textContent = "×";
    close.title = `Close ${tabLabel(tab)}`;
    close.setAttribute("aria-label", close.title);
    close.addEventListener("click", () => closeTab(tab.id));
    item.append(select, close);
    tabList.append(item);
  }
}

function captureActiveTab() {
  const tab = activeTab();
  if (!tab || !selected) {
    return true;
  }
  try {
    const current = currentNoteData({ allowReadOnly: true });
    tab.note = { ...selected, ...current };
    tab.noteId = selected.id;
    tab.scope = NoteTabs.scopeForNote(selected);
    tab.dirty = dirty;
    selected = tab.note;
    return true;
  } catch (error) {
    saveState.textContent = errorText(error);
    return false;
  }
}

function displayActiveTab() {
  const tab = activeTab();
  if (!tab) {
    showEmptyState();
  } else if (tab.note) {
    showSelectedNote(tab.note, { isDirty: tab.dirty });
  } else {
    showEmptyState({ scope: tab.scope });
  }
}

function activateTab(tabId, { capture = true } = {}) {
  if (tabId === activeTabId) {
    return true;
  }
  if (capture && !captureActiveTab()) {
    return false;
  }
  activeTabId = tabId;
  selectionRequest += 1;
  displayActiveTab();
  return true;
}

function closeTab(tabId) {
  const index = openTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) {
    return;
  }
  const tab = openTabs[index];
  if (tab.dirty && !window.confirm(`Discard unsaved changes in “${tabLabel(tab)}”?`)) {
    return;
  }
  openTabs.splice(index, 1);
  if (tabId === activeTabId) {
    activeTabId = openTabs[Math.min(index, openTabs.length - 1)]?.id || null;
    selectionRequest += 1;
    displayActiveTab();
  } else {
    renderTabs();
  }
}

function addEmptyTab(scope) {
  if (!captureActiveTab()) {
    return null;
  }
  const tab = { id: crypto.randomUUID(), noteId: null, note: null, scope, dirty: false };
  openTabs.push(tab);
  activeTabId = tab.id;
  selectionRequest += 1;
  displayActiveTab();
  return tab;
}

function setDirty(value) {
  const tab = activeTab();
  const changed = dirty !== value || (tab && tab.dirty !== value);
  dirty = value;
  if (tab) {
    tab.dirty = value;
  }
  saveState.textContent = value ? "Unsaved" : selected ? "Saved" : "";
  saveButton.disabled = !selected || !value || Boolean(selected.readOnly);
  if (changed) {
    renderTabs();
  }
}

function canLeaveCurrentNote() {
  captureActiveTab();
  const dirtyTabs = openTabs.filter(tab => tab.dirty);
  if (!dirtyTabs.length) {
    return true;
  }
  if (!window.confirm(`Discard unsaved changes in ${dirtyTabs.length} open tab${dirtyTabs.length === 1 ? "" : "s"}?`)) {
    return false;
  }
  return true;
}

function closeApplication() {
  if (!canLeaveCurrentNote()) {
    return;
  }
  for (const tab of openTabs) {
    tab.dirty = false;
  }
  dirty = false;
  window.notesApi.close();
}

function currentNoteData({ allowReadOnly = false } = {}) {
  if (!selected) {
    return null;
  }
  if (selected.readOnly) {
    return allowReadOnly ? {
      id: selected.id,
      title: selected.title,
      bodyHtml: selected.bodyHtml,
      images: selected.images || [],
      readOnly: true,
      unsupportedReason: selected.unsupportedReason || "",
      home: selected.home,
    } : null;
  }
  const content = collectEditorNote();
  return {
    id: selected.id,
    title: title.value.trim() || "New note",
    ...content,
  };
}

async function pastePlainText() {
  if (!selected || !editor || editorArea.hidden) {
    return;
  }
  try {
    const text = await window.notesApi.clipboard.readText();
    if (!text) {
      return;
    }
    editor.insertHTML(NotePaste.plainTextToHtml(text), true, false);
    editor.focus();
    setDirty(true);
    scheduleSearchHighlights();
  } catch (error) {
    saveState.textContent = errorText(error);
  }
}

function isEditorTarget(target) {
  return target instanceof Element
    && Boolean(target.closest("#editor-area .se-wrapper-wysiwyg"));
}

function updateAiComposeVisibility() {
  aiCompose.hidden = !availableAiProviders.length
    || !selected
    || selected.readOnly
    || editorArea.hidden;
}

function updateAiPromptPlaceholder() {
  const label = availableAiProviders.find(provider => provider.value === aiProvider.value)?.label
    || "AI";
  aiPrompt.placeholder = `Ask ${label} about this note…`;
}

function configureAiProviders(llmSettings) {
  const currentProvider = aiProvider.value;
  availableAiProviders = [];
  if (llmSettings?.hasGeminiApiKey) {
    availableAiProviders.push({ value: "gemini", label: "Gemini" });
  }
  if (llmSettings?.hasOpenAiApiKey) {
    availableAiProviders.push({ value: "openai", label: "ChatGPT" });
  }
  aiProvider.replaceChildren(
    ...availableAiProviders.map(provider => new Option(provider.label, provider.value)),
  );
  aiProvider.value = availableAiProviders.some(provider => provider.value === currentProvider)
    ? currentProvider
    : availableAiProviders[0]?.value || "";
  updateAiPromptPlaceholder();
  updateAiComposeVisibility();
}

function resizeAiPrompt() {
  aiPrompt.style.height = "auto";
  aiPrompt.style.height = `${Math.min(aiPrompt.scrollHeight, 160)}px`;
}

function rememberEditorInsertionPoint() {
  const editable = editorArea.querySelector(".sun-editor-editable");
  const selection = window.getSelection();
  if (!editable || !selection?.rangeCount || !editable.contains(selection.anchorNode)) {
    return;
  }
  editorInsertionRange = selection.getRangeAt(0).cloneRange();
}

function restoreEditorInsertionPoint(range) {
  const editable = editorArea.querySelector(".sun-editor-editable");
  if (!editable) {
    return;
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (range && editable.contains(range.commonAncestorContainer)) {
    selection.addRange(range);
  } else {
    const endRange = document.createRange();
    endRange.selectNodeContents(editable);
    endRange.collapse(false);
    selection.addRange(endRange);
  }
  editable.focus();
}

function safeGeneratedLink(value) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(String(value || "")).protocol);
  } catch {
    return false;
  }
}

function sanitizeGeneratedMarkdownHtml(html) {
  const allowedTags = new Set([
    "A", "BLOCKQUOTE", "BR", "CODE", "DEL", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
    "HR", "LI", "OL", "P", "PRE", "STRONG", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL",
  ]);
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent || ""));
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const allowed = (element.tagName === "A" && ["href", "title"].includes(name))
        || (element.tagName === "OL" && name === "start" && /^\d+$/.test(value))
        || (["TD", "TH"].includes(element.tagName) && name === "align" && /^(left|center|right)$/.test(value))
        || (element.tagName === "CODE" && name === "class" && /^language-[a-z0-9_+-]+$/i.test(value));
      if (!allowed || (element.tagName === "A" && name === "href" && !safeGeneratedLink(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return sanitizeHtml(template.innerHTML);
}

function aiExchangeHtml(providerLabel, prompt, responseHtml) {
  const labelHtml = NotePaste.plainTextToHtml(providerLabel);
  const promptHtml = NotePaste.plainTextToHtml(prompt);
  const safeResponseHtml = sanitizeGeneratedMarkdownHtml(responseHtml);
  return [
    "<div><br></div>",
    `<div><strong>${labelHtml} prompt:</strong></div>`,
    `<div>${promptHtml}</div>`,
    `<div><strong>${labelHtml}:</strong></div>`,
    `<div>${safeResponseHtml}</div>`,
  ].join("");
}

async function submitAiPrompt() {
  const prompt = aiPrompt.value.trim();
  if (!prompt || !selected || selected.readOnly || aiSubmit.disabled) {
    return;
  }
  const note = currentNoteData();
  const requestedNoteId = selected.id;
  const requestedTabId = activeTabId;
  const requestedRange = editorInsertionRange?.cloneRange() || null;
  aiProvider.disabled = true;
  aiPrompt.disabled = true;
  aiSubmit.disabled = true;
  setStatus(aiState, "Waiting for the answer…", "working");
  try {
    const result = await window.notesApi.llm.ask({
      provider: aiProvider.value,
      prompt,
      title: note.title,
      bodyHtml: note.bodyHtml,
    });
    if (selected?.id !== requestedNoteId || activeTabId !== requestedTabId) {
      throw new Error("The active note changed while the answer was being generated. Nothing was inserted.");
    }
    restoreEditorInsertionPoint(requestedRange);
    editor.insertHTML(aiExchangeHtml(
      result.providerLabel,
      prompt,
      result.html || NotePaste.plainTextToHtml(result.text),
    ), true, false);
    rememberEditorInsertionPoint();
    setDirty(true);
    aiPrompt.value = "";
    resizeAiPrompt();
    setStatus(aiState, "Inserted at the cursor position. Save the note to keep it.", "success");
  } catch (error) {
    setStatus(aiState, errorText(error));
    try {
      await loadSettings();
    } catch {
      // Keep the provider error visible if settings cannot be refreshed.
    }
  } finally {
    aiProvider.disabled = false;
    aiPrompt.disabled = false;
    aiSubmit.disabled = false;
    aiPrompt.focus();
  }
}

function visibleNotes() {
  const query = searchInput.value.trim();
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
    return NoteSearch.matchesSearchText(`${note.searchText || ""} ${homeLabel(note)}`, query);
  });
}

function renderHighlightedText(element, value, query) {
  const text = String(value || "");
  const matches = NoteSearch.findSearchMatches([text], query);
  let offset = 0;
  for (const match of matches) {
    element.append(text.slice(offset, match.startOffset));
    const highlight = document.createElement("mark");
    highlight.className = "search-result-highlight";
    highlight.textContent = text.slice(match.startOffset, match.endOffset);
    element.append(highlight);
    offset = match.endOffset;
  }
  element.append(text.slice(offset));
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
    renderHighlightedText(noteTitle, note.title, searchInput.value.trim());

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

function showSelectedNote(note, { isDirty = false } = {}) {
  const changedNote = selected?.id !== note.id;
  selected = note;
  editorInsertionRange = null;
  suppressChanges = true;
  title.value = note.title;
  editor.setContents(editorHtmlForNote(note));
  editor.readOnly(Boolean(note.readOnly));
  suppressChanges = false;
  noteHome.textContent = homeLabel(note);
  noteHome.title = note.home.kind === "imap"
    ? `Changes are saved to ${homeLabel(note)}`
    : "Stored only on this computer";
  emptyState.hidden = true;
  editorArea.hidden = false;
  if (changedNote) {
    aiPrompt.value = "";
    setStatus(aiState, "", "success");
    resizeAiPrompt();
  }
  updateAiComposeVisibility();
  title.disabled = Boolean(note.readOnly);
  deleteButton.disabled = false;
  exportButton.disabled = false;
  setDirty(isDirty);
  if (note.readOnly) {
    saveState.textContent = note.unsupportedReason
      || "This note contains unsupported content and is read-only.";
  }
  renderList();
  renderTabs();
  updateSearchHighlights();
}

function showEmptyState({ scope = null } = {}) {
  clearSearchHighlights();
  clearManagedImageUrls();
  selected = null;
  editorInsertionRange = null;
  dirty = false;
  title.value = "";
  title.disabled = true;
  noteHome.textContent = "";
  deleteButton.disabled = true;
  exportButton.disabled = true;
  emptyState.hidden = false;
  editorArea.hidden = true;
  aiCompose.hidden = true;
  emptyStateTitle.textContent = "No note selected";
  emptyStateCopy.textContent = scope
    ? `Select a note from ${scopeLabel(scope)} or create a new note there.`
    : "Create a note, configure an IMAP account, or synchronize your accounts.";
  setDirty(false);
  renderList();
  renderTabs();
}

function openNoteInTab(note) {
  const target = NoteTabs.noteTarget(openTabs, activeTabId, note);
  if (target.action === "activate") {
    activateTab(target.tabId);
    return;
  }
  if (!captureActiveTab()) {
    return;
  }
  if (target.action === "reuse") {
    const tab = openTabs.find(item => item.id === target.tabId);
    tab.note = note;
    tab.noteId = note.id;
    tab.scope = NoteTabs.scopeForNote(note);
    tab.dirty = false;
    activeTabId = tab.id;
  } else {
    const tab = {
      id: crypto.randomUUID(),
      noteId: note.id,
      note,
      scope: NoteTabs.scopeForNote(note),
      dirty: false,
    };
    openTabs.push(tab);
    activeTabId = tab.id;
  }
  displayActiveTab();
}

async function selectNote(id) {
  const alreadyOpen = openTabs.find(tab => tab.noteId === id);
  if (alreadyOpen) {
    activateTab(alreadyOpen.id);
    return;
  }
  const request = ++selectionRequest;
  saveState.textContent = "Loading…";
  try {
    const note = await window.notesApi.get(id);
    if (request !== selectionRequest) {
      return;
    }
    if (!note) {
      await refreshNotes();
      return;
    }
    openNoteInTab(note);
  } catch (error) {
    if (request === selectionRequest) {
      saveState.textContent = errorText(error);
    }
  }
}

async function refreshNotes() {
  notes = (await window.notesApi.list()).sort((a, b) => b.updatedAt - a.updatedAt);
  renderList();
}

async function reconcileCleanTabs() {
  const active = activeTab();
  for (const tab of openTabs) {
    if (!tab.noteId || tab.dirty) {
      continue;
    }
    if (notes.some(note => note.id === tab.noteId)) {
      tab.note = await window.notesApi.get(tab.noteId);
    } else {
      tab.note = null;
      tab.noteId = null;
    }
  }
  if (active && active.id === activeTabId) {
    displayActiveTab();
  } else {
    renderTabs();
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

function updateApiKeyVisualState(input) {
  const hasCandidate = Boolean(input.value.trim());
  const hasValidStoredKey = input.dataset.hasStoredKey === "true" && !hasCandidate;
  input.classList.toggle("has-valid-secret", hasValidStoredKey);
  input.classList.toggle("has-pending-secret", hasCandidate);
  input.placeholder = hasValidStoredKey ? "••••••••  Valid" : "Enter API key";
  input.title = hasCandidate
    ? "This API key will be validated when settings are saved"
    : hasValidStoredKey
      ? "A valid API key is stored"
      : "No valid API key is stored";
}

function showStoredApiKeyState(input, hasStoredKey) {
  input.value = "";
  input.dataset.hasStoredKey = String(Boolean(hasStoredKey));
  updateApiKeyVisualState(input);
}

async function loadSettings() {
  const settings = await window.notesApi.settings.list();
  accounts = settings.accounts;
  document.getElementById("credential-protection").textContent = settings.credentialProtection;
  for (const element of document.querySelectorAll(".credential-protection-copy")) {
    element.textContent = settings.credentialProtection;
  }
  showStoredApiKeyState(openAiApiKey, settings.llm?.hasOpenAiApiKey);
  showStoredApiKeyState(geminiApiKey, settings.llm?.hasGeminiApiKey);
  sentryDsn.value = settings.diagnostics?.sentryDsn || "";
  configureAiProviders(settings.llm);
  renderAccountChoices();
  renderList();
  return settings;
}

async function changeAccountFilter() {
  renderList();
  const scope = accountFilter.value;
  const target = NoteTabs.accountTarget(openTabs, activeTabId, scope);
  if (target.action === "activate") {
    activateTab(target.tabId);
  } else if (target.action === "create") {
    addEmptyTab(scope);
  }
  if (scope === "all" || scope === "local") {
    return;
  }
  syncState.textContent = `Checking ${scopeLabel(scope)}…`;
  try {
    const result = await window.notesApi.settings.ensureMailbox(scope);
    syncState.textContent = result.created
      ? `Created folder “${result.mailbox}” in ${scopeLabel(scope)}`
      : `Folder “${result.mailbox}” is ready in ${scopeLabel(scope)}`;
  } catch (error) {
    syncState.textContent = errorText(error);
  }
}

function updateNewNoteFolder() {
  const account = accounts.find(item => item.id === newNoteHome.value);
  newNoteFolder.textContent = account
    ? `This note will always save back to ${account.name}, folder “${account.mailbox}”.`
    : "This note will be stored only on this computer.";
}

function openNewNoteDialog(input = null) {
  pendingCreateInput = input;
  const filter = accountFilter.value;
  const defaultAccount = accounts.find(account => account.id === filter && account.enabled)
    || accounts.find(account => account.id === selected?.home?.accountId && account.enabled)
    || accounts.filter(account => account.enabled).length === 1 && accounts.find(account => account.enabled);
  newNoteHome.value = defaultAccount?.id || "local";
  updateNewNoteFolder();
  newNoteShareLink.value = "";
  newNoteState.textContent = "";
  newNoteState.removeAttribute("data-state");
  newNoteDialog.showModal();
}

async function completeCreateNote() {
  if (!captureActiveTab()) {
    throw new Error("The current tab could not be preserved.");
  }
  const note = await window.notesApi.create({
    accountId: newNoteHome.value,
    title: pendingCreateInput?.title || "New note",
    bodyHtml: sanitizeHtml(pendingCreateInput?.bodyHtml || "<div><br></div>"),
  });
  pendingCreateInput = null;
  await refreshNotes();
  openNoteInTab(note);
  syncState.textContent = `Created in ${homeLabel(note)}`;
  title.focus();
  title.select();
}

async function saveNote() {
  try {
    const note = currentNoteData();
    if (!note) {
      return;
    }
    saveButton.disabled = true;
    saveState.textContent = selected.home?.kind === "imap" ? "Saving to IMAP…" : "Saving…";
    const result = await window.notesApi.save(note);
    const tab = activeTab();
    if (tab) {
      tab.note = result.note;
      tab.noteId = result.note.id;
      tab.scope = NoteTabs.scopeForNote(result.note);
      tab.dirty = false;
    }
    selected = result.note;
    dirty = false;
    await refreshNotes();
    displayActiveTab();
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
    const deletedTab = activeTab();
    const deletedIndex = openTabs.indexOf(deletedTab);
    await window.notesApi.delete(selected.id);
    if (deletedIndex >= 0) {
      openTabs.splice(deletedIndex, 1);
    }
    activeTabId = openTabs[Math.min(Math.max(deletedIndex, 0), openTabs.length - 1)]?.id || null;
    selected = null;
    await refreshNotes();
    displayActiveTab();
  } catch (error) {
    saveState.textContent = errorText(error);
  }
}

async function importNote() {
  const imported = await window.notesApi.import();
  if (imported) {
    openNewNoteDialog(imported);
  }
}

async function exportNote() {
  try {
    const note = currentNoteData({ allowReadOnly: true });
    if (note) {
      await window.notesApi.export(note);
    }
  } catch (error) {
    saveState.textContent = errorText(error);
  }
}

async function syncNotes() {
  if (!captureActiveTab()) {
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
    await refreshNotes();
    await reconcileCleanTabs();
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

function setStatus(element, message, state = "error") {
  element.textContent = message;
  element.dataset.state = state;
}

function setSettingsState(message, state = "error") {
  setStatus(settingsState, message, state);
}

function conversationProviderLabel(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().includes("gemini") ? "Gemini" : "ChatGPT";
  } catch {
    return "Gemini / ChatGPT";
  }
}

async function importSharedConversation() {
  if (!captureActiveTab()) {
    return false;
  }
  if (openTabs.some(tab => tab.dirty)) {
    setStatus(newNoteState, "Save all open note changes before importing a conversation.");
    return false;
  }
  const url = newNoteShareLink.value.trim();
  if (!url) {
    setStatus(newNoteState, "Enter a public Gemini or ChatGPT conversation link.");
    newNoteShareLink.focus();
    return false;
  }
  if (!newNoteShareLink.reportValidity()) {
    return false;
  }
  const providerLabel = conversationProviderLabel(url);
  importConversationLinkButton.disabled = true;
  setStatus(newNoteState, `Loading the public ${providerLabel} conversation…`, "working");
  try {
    const result = await window.notesApi.conversations.import({
      url,
      accountId: newNoteHome.value,
    });
    if (result.status === "canceled") {
      setStatus(newNoteState, "Import canceled.", "working");
      return false;
    }
    if (result.status === "conflict") {
      setStatus(newNoteState, `${result.message} Note: “${result.note.title}”.`);
      return false;
    }
    await refreshNotes();
    await reconcileCleanTabs();
    const imported = await window.notesApi.get(result.note.id);
    if (imported) {
      openNoteInTab(imported);
    }
    newNoteShareLink.value = "";
    const action = result.status === "created" ? "created" : "updated";
    const additions = result.status === "updated"
      ? ` ${result.appendedTurns} new prompt/answer block${result.appendedTurns === 1 ? "" : "s"} appended.`
      : "";
    const history = result.history?.warning
      ? ` The note is safe, but Git history failed: ${result.history.warning}`
      : result.history?.oid
        ? ` Git ${result.history.oid.slice(0, 8)} in ${result.history.root}.`
        : "";
    const saveWarning = result.warning ? ` ${result.warning}` : "";
    syncState.textContent = `${providerLabel} note ${action}.${additions}${saveWarning}${history}`;
    return true;
  } catch (error) {
    setStatus(newNoteState, errorText(error));
    return false;
  } finally {
    importConversationLinkButton.disabled = false;
  }
}

async function saveSettings() {
  const form = document.getElementById("settings-form");
  if (!form.reportValidity()) {
    return;
  }
  setSettingsState("Saving settings and creating missing Notes folders…", "working");
  try {
    const accountValues = [...accountList.querySelectorAll(".account-card")].map(collectAccount);
    await window.notesApi.settings.save({
      accounts: accountValues,
      llm: {
        openaiApiKey: openAiApiKey.value,
        geminiApiKey: geminiApiKey.value,
      },
      diagnostics: {
        sentryDsn: sentryDsn.value,
      },
    });
    await loadSettings();
    settingsDialog.close("save");
    await syncNotes();
  } catch (error) {
    const message = errorText(error);
    if (message.includes("API key validation failed")) {
      await loadSettings();
    }
    setSettingsState(message);
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
      ["link", "image", "table", "horizontalRule"],
      ["removeFormat", "codeView", "fullScreen"],
    ],
    imageAccept: "image/jpeg,image/png,image/gif,image/webp",
    imageFileInput: true,
    imageMultipleFile: true,
    imageUploadSizeLimit: MAX_IMAGE_BYTES,
    imageUrlInput: false,
    callBackSave: saveNote,
  });
  editor.onImageUploadBefore = files => {
    const supported = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
    if ([...files].some(file => !supported.has(file.type))) {
      saveState.textContent = "Only JPEG, PNG, GIF and WebP images are supported.";
      return false;
    }
    return true;
  };
  editor.onChange = () => {
    if (!suppressChanges && selected) {
      setDirty(true);
    }
    scheduleSearchHighlights();
  };
  openAiApiKey.addEventListener("input", () => updateApiKeyVisualState(openAiApiKey));
  geminiApiKey.addEventListener("input", () => updateApiKeyVisualState(geminiApiKey));
  document.addEventListener("selectionchange", rememberEditorInsertionPoint);
  aiProvider.addEventListener("change", updateAiPromptPlaceholder);
  aiPrompt.addEventListener("input", resizeAiPrompt);
  aiPrompt.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submitAiPrompt();
    }
  });
  aiCompose.addEventListener("submit", event => {
    event.preventDefault();
    submitAiPrompt();
  });
  resizeAiPrompt();

  document.getElementById("new-note").addEventListener("click", () => openNewNoteDialog());
  document.getElementById("import-note").addEventListener("click", importNote);
  document.getElementById("sync-notes").addEventListener("click", syncNotes);
  document.getElementById("open-settings").addEventListener("click", openSettings);
  document.getElementById("open-dev-tools").addEventListener("click", () => {
    window.notesApi.diagnostics.openDevTools();
  });
  checkUpdatesButton.addEventListener("click", () => window.notesApi.updates.check());
  updateAppButton.addEventListener("click", useUpdateButton);
  closeAppButton.addEventListener("click", closeApplication);
  document.getElementById("add-account").addEventListener("click", () => addAccountCard());
  importConversationLinkButton.addEventListener("click", () => {
    importSharedConversation().then(imported => {
      if (imported) {
        newNoteDialog.close("import");
      }
    });
  });
  saveButton.addEventListener("click", saveNote);
  deleteButton.addEventListener("click", deleteNote);
  exportButton.addEventListener("click", exportNote);
  window.notesApi.editor.onPastePlainText(pastePlainText);
  title.addEventListener("input", () => {
    if (!selected) {
      return;
    }
    selected.title = title.value;
    const tab = activeTab();
    if (tab?.note) {
      tab.note.title = title.value;
    }
    setDirty(true);
    renderTabs();
  });
  searchInput.addEventListener("input", () => {
    renderList();
    scheduleSearchHighlights();
  });
  accountFilter.addEventListener("change", () => {
    changeAccountFilter().catch(error => { syncState.textContent = errorText(error); });
  });
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
    if (
      (event.ctrlKey || event.metaKey)
      && event.shiftKey
      && event.key.toLowerCase() === "v"
      && isEditorTarget(event.target)
    ) {
      event.preventDefault();
      pastePlainText();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveNote();
    }
  });
  window.addEventListener("beforeunload", event => {
    if (dirty || openTabs.some(tab => tab.dirty)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("unload", clearManagedImageUrls);

  await initializeUpdates();
  await loadSettings();
  await refreshNotes();
  if (notes[0]) {
    await selectNote(notes[0].id);
  } else {
    showEmptyState();
  }
  if (accounts.some(account => account.enabled)) {
    await syncNotes();
  }
}

window.addEventListener("error", event => {
  window.notesApi.diagnostics.reportError({
    name: event.error?.name || "RendererError",
    message: event.error?.message || event.message,
    stack: event.error?.stack || "",
  });
});

window.addEventListener("unhandledrejection", event => {
  const reason = event.reason;
  window.notesApi.diagnostics.reportError({
    name: reason?.name || "UnhandledRejection",
    message: reason?.message || String(reason),
    stack: reason?.stack || "",
  });
});

window.addEventListener("DOMContentLoaded", () => {
  init().catch(error => {
    syncState.textContent = errorText(error);
    window.notesApi.diagnostics.reportError({
      name: error?.name || "InitializationError",
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
  });
});
