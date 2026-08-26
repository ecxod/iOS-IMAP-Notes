const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_TITLE_LENGTH = 500;
const MAX_NOTE_LENGTH = 10 * 1024 * 1024;

function notesFile() {
  return path.join(app.getPath("userData"), "notes.json");
}

function cleanTitle(value, fallback = "New note") {
  const title = String(value || "").trim().slice(0, MAX_TITLE_LENGTH);
  return title || fallback;
}

function normalizeNote(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const bodyHtml = String(value.bodyHtml || "").slice(0, MAX_NOTE_LENGTH);
  return {
    id: typeof value.id === "string" && value.id ? value.id : randomUUID(),
    title: cleanTitle(value.title),
    bodyHtml,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

async function readNotes() {
  try {
    const data = JSON.parse(await fs.readFile(notesFile(), "utf8"));
    return Array.isArray(data) ? data.map(normalizeNote).filter(Boolean) : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeNotes(notes) {
  const target = notesFile();
  const temporary = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 500,
    title: "iOS IMAP Notes Offline",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
    },
  });
  await window.loadFile("index.html");
}

ipcMain.handle("notes:list", readNotes);

ipcMain.handle("notes:create", async (_event, title) => {
  const notes = await readNotes();
  const note = normalizeNote({
    id: randomUUID(),
    title: cleanTitle(title),
    bodyHtml: "<div><br></div>",
    updatedAt: Date.now(),
  });
  notes.unshift(note);
  await writeNotes(notes);
  return note;
});

ipcMain.handle("notes:save", async (_event, input) => {
  const note = normalizeNote(input);
  if (!note) {
    throw new Error("Invalid note data");
  }
  const notes = await readNotes();
  const index = notes.findIndex(item => item.id === note.id);
  note.updatedAt = Date.now();
  if (index === -1) {
    notes.unshift(note);
  } else {
    notes[index] = note;
  }
  await writeNotes(notes);
  return note;
});

ipcMain.handle("notes:delete", async (_event, id) => {
  const notes = await readNotes();
  const remaining = notes.filter(note => note.id !== id);
  if (remaining.length !== notes.length) {
    await writeNotes(remaining);
  }
  return remaining;
});

ipcMain.handle("notes:import", async event => {
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
});

ipcMain.handle("notes:export", async (event, input) => {
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
    note.bodyHtml,
    "</body></html>",
  ].join("");
  await fs.writeFile(result.filePath, html, "utf8");
  return true;
});

app.whenReady().then(async () => {
  await createWindow();
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
