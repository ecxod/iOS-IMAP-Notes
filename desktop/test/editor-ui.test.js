const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");

test("editor actions use icon-only buttons with accessible tooltips", async () => {
  const html = await readFile(path.join(desktopRoot, "index.html"), "utf8");
  for (const [id, label] of [
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

test("the editor bundles and applies Roboto", async () => {
  const [css, license] = await Promise.all([
    readFile(path.join(desktopRoot, "styles.css"), "utf8"),
    readFile(path.join(desktopRoot, "vendor", "roboto-OFL.txt"), "utf8"),
  ]);
  assert.match(css, /@font-face\s*{[\s\S]*font-family: "Roboto";[\s\S]*data:font\/woff2;base64,/);
  assert.match(css, /#editor-area \.sun-editor-editable\s*{\s*font-family: "Roboto", Arial, sans-serif;/);
  assert.match(license, /SIL OPEN FONT LICENSE/);
});
