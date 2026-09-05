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
  assert.match(preload, /editor:show-context-menu/);
  assert.match(renderer, /addEventListener\("contextmenu"/);
  assert.match(renderer, /onPastePlainText\(pastePlainText\)/);
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
