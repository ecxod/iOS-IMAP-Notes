const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");

test("editor actions use icon-only buttons with accessible tooltips", async () => {
  const html = await readFile(path.join(desktopRoot, "index.html"), "utf8");
  for (const [id, label] of [
    ["new-note", "New Note"],
    ["import-note", "Import Note"],
    ["sync-notes", "Sync Notes"],
    ["open-settings", "Settings"],
    ["delete-note", "Delete Note"],
    ["save-note", "Save Note"],
    ["export-note", "Export Note"],
    ["close-app", "Close"],
  ]) {
    const button = html.match(new RegExp(`<button id="${id}"[^>]*>[\\s\\S]*?</button>`))?.[0];
    assert.ok(button, `${id} button is missing`);
    assert.match(button, /class="[^"]*icon-button/);
    assert.match(button, new RegExp(`title="${label}"`));
    assert.match(button, new RegExp(`aria-label="${label}"`));
    assert.doesNotMatch(button.replace(/<svg[\s\S]*<\/svg>/, ""), />\s*[A-Za-z]+\s*</);
  }
});

test("plain-text paste is offered from the editor context menu instead of the toolbar", async () => {
  const [html, main, preload, renderer] = await Promise.all([
    readFile(path.join(desktopRoot, "index.html"), "utf8"),
    readFile(path.join(desktopRoot, "main.js"), "utf8"),
    readFile(path.join(desktopRoot, "preload.js"), "utf8"),
    readFile(path.join(desktopRoot, "renderer.js"), "utf8"),
  ]);
  assert.doesNotMatch(html, /id="paste-plain-text"/);
  assert.match(main, /label: "Paste"[\s\S]*role: "paste"/);
  assert.match(main, /label: "Paste Plain Text"/);
  assert.match(main, /webContents\.on\("context-menu"/);
  assert.doesNotMatch(preload, /editor:show-context-menu/);
  assert.doesNotMatch(renderer, /addEventListener\("contextmenu"/);
  assert.match(renderer, /onPastePlainText\(pastePlainText\)/);
});

test("editor context menu offers spelling suggestions and a persistent language choice", async () => {
  const main = await readFile(path.join(desktopRoot, "main.js"), "utf8");
  assert.match(main, /params\.dictionarySuggestions[\s\S]*replaceMisspelling\(suggestion\)/);
  assert.match(main, /label: "Add to dictionary"[\s\S]*addWordToSpellCheckerDictionary/);
  assert.match(main, /label: "Check spelling"[\s\S]*spellCheckerEnabled/);
  assert.match(main, /label: "Spelling language"[\s\S]*spellcheckLanguageMenu/);
  assert.match(main, /spellcheckSettingsFile\(\)[\s\S]*spellcheck\.json/);
});

test("the editor bundles and applies Roboto", async () => {
  const [css, license] = await Promise.all([
    readFile(path.join(desktopRoot, "styles.css"), "utf8"),
    readFile(path.join(desktopRoot, "vendor", "roboto-OFL.txt"), "utf8"),
  ]);
  assert.match(css, /@font-face\s*{[\s\S]*font-family: "Roboto";[\s\S]*data:font\/woff2;base64,/);
  assert.match(css, /#editor-area \.sun-editor-editable\s*{\s*font-family: "Roboto", Arial, sans-serif;/);
  assert.match(license, /SIL OPEN FONT LICENSE/);
});

test("the editable note shows a high-contrast text caret and focus boundary", async () => {
  const css = await readFile(path.join(desktopRoot, "styles.css"), "utf8");
  assert.match(css, /\.sun-editor-editable\[contenteditable="true"\]:not\(\.se-read-only\)\s*{[^}]*caret-color:\s*#0067c0/s);
  assert.match(css, /\.sun-editor-editable\[contenteditable="true"\]:not\(\.se-read-only\):focus\s*{[^}]*outline:/s);
});

test("notes are normalized before SunEditor receives list content", async () => {
  const [html, renderer, packageJson] = await Promise.all([
    readFile(path.join(desktopRoot, "index.html"), "utf8"),
    readFile(path.join(desktopRoot, "renderer.js"), "utf8"),
    readFile(path.join(desktopRoot, "package.json"), "utf8"),
  ]);
  assert.match(html, /<script defer src="editor-html\.js"><\/script>[\s\S]*renderer\.js/);
  assert.match(renderer, /NoteEditorHtml\.normalizeForSunEditor\(sanitizeHtml\(template\.innerHTML\)\)/);
  assert.match(packageJson, /"editor-html\.js"/);
});
