/* global SUNEDITOR */

let notes = [];
let selected = null;
let editor = null;
let dirty = false;
let suppressChanges = false;

const list = document.getElementById("note-list");
const title = document.getElementById("note-title");
const saveState = document.getElementById("save-state");
const emptyState = document.getElementById("empty-state");
const editorArea = document.getElementById("editor-area");
const saveButton = document.getElementById("save-note");
const deleteButton = document.getElementById("delete-note");
const exportButton = document.getElementById("export-note");

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
      if (name.startsWith("on") || (["href", "src", "xlink:href"].includes(name) && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.innerHTML;
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
    ...selected,
    title: title.value.trim() || "New note",
    bodyHtml: sanitizeHtml(editor.getContents()),
  };
}

function renderList() {
  list.replaceChildren();
  for (const note of notes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = note.id;
    button.setAttribute("aria-current", String(note.id === selected?.id));

    const noteTitle = document.createElement("span");
    noteTitle.className = "note-list-title";
    noteTitle.textContent = note.title;

    const date = document.createElement("span");
    date.className = "note-list-date";
    date.textContent = new Date(note.updatedAt).toLocaleString();

    button.append(noteTitle, date);
    button.addEventListener("click", () => selectNote(note.id));
    item.append(button);
    list.append(item);
  }
}

function showSelectedNote(note) {
  selected = note;
  suppressChanges = true;
  title.value = note.title;
  editor.setContents(sanitizeHtml(note.bodyHtml));
  suppressChanges = false;
  emptyState.hidden = true;
  editorArea.hidden = false;
  title.disabled = false;
  deleteButton.disabled = false;
  exportButton.disabled = false;
  setDirty(false);
  renderList();
}

function showEmptyState() {
  selected = null;
  title.value = "";
  title.disabled = true;
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
  notes = (await window.notesApi.list())
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const note = notes.find(item => item.id === preferredId) || notes[0];
  if (note) {
    showSelectedNote(note);
  } else {
    showEmptyState();
  }
}

async function createNote(input = null, leaveWasConfirmed = false) {
  if (!leaveWasConfirmed && !canLeaveCurrentNote()) {
    return;
  }
  const note = await window.notesApi.create(input?.title || "New note");
  if (input?.bodyHtml) {
    note.bodyHtml = sanitizeHtml(input.bodyHtml);
    await window.notesApi.save(note);
  }
  await reloadNotes(note.id);
  title.focus();
  title.select();
}

async function saveNote() {
  const note = currentNoteData();
  if (!note) {
    return;
  }
  saveButton.disabled = true;
  saveState.textContent = "Saving…";
  const saved = await window.notesApi.save(note);
  await reloadNotes(saved.id);
}

async function deleteNote() {
  if (!selected || !window.confirm(`Delete “${selected.title}”?`)) {
    return;
  }
  await window.notesApi.delete(selected.id);
  selected = null;
  await reloadNotes();
}

async function importNote() {
  if (!canLeaveCurrentNote()) {
    return;
  }
  const imported = await window.notesApi.import();
  if (imported) {
    await createNote(imported, true);
  }
}

async function exportNote() {
  const note = currentNoteData();
  if (note) {
    await window.notesApi.export(note);
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
  };

  document.getElementById("new-note").addEventListener("click", () => createNote());
  document.getElementById("import-note").addEventListener("click", importNote);
  saveButton.addEventListener("click", saveNote);
  deleteButton.addEventListener("click", deleteNote);
  exportButton.addEventListener("click", exportNote);
  title.addEventListener("input", () => selected && setDirty(true));
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

  await reloadNotes();
}

window.addEventListener("DOMContentLoaded", init);
