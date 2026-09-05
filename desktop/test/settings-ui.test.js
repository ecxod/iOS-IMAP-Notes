const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");

test("settings offer masked OpenAI and Gemini API key inputs", async () => {
  const html = await readFile(path.join(desktopRoot, "index.html"), "utf8");
  for (const [id, label] of [
    ["openai-api-key", "OpenAI API key"],
    ["gemini-api-key", "API key"],
  ]) {
    assert.match(html, new RegExp(`${label}[\\s\\S]*<input id="${id}"[^>]*type="password"`));
  }
});

test("renderer submits API keys without receiving stored plaintext", async () => {
  const renderer = await readFile(path.join(desktopRoot, "renderer.js"), "utf8");
  assert.match(renderer, /llm:\s*{\s*openaiApiKey: openAiApiKey\.value,\s*geminiApiKey: geminiApiKey\.value/);
  assert.match(renderer, /settings\.llm\?\.hasOpenAiApiKey/);
  assert.match(renderer, /settings\.llm\?\.hasGeminiApiKey/);
});

test("new note dialog provides desktop-only public-link import controls", async () => {
  const [html, preload, renderer] = await Promise.all([
    readFile(path.join(desktopRoot, "index.html"), "utf8"),
    readFile(path.join(desktopRoot, "preload.js"), "utf8"),
    readFile(path.join(desktopRoot, "renderer.js"), "utf8"),
  ]);
  for (const id of [
    "new-note-home",
    "new-note-share-link",
    "import-conversation-link",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const removedId of ["chatgpt-share-link", "gemini-share-link", "conversation-import-home"]) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`));
  }
  assert.match(preload, /conversations:import/);
  assert.match(renderer, /notesApi\.conversations\.import/);
  assert.match(renderer, /accountId: newNoteHome\.value/);
});

test("settings use compact account and provider rows", async () => {
  const styles = await readFile(path.join(desktopRoot, "styles.css"), "utf8");
  assert.match(styles, /#settings-dialog\s*{[^}]*1040px/s);
  assert.match(styles, /#account-list:not\(:empty\)\s*{[^}]*min-height/s);
  assert.match(styles, /\.account-grid\s*{[^}]*grid-template-columns:[^;}]*minmax\(8rem/s);
  assert.match(styles, /\.ai-provider-card\s*{[^}]*grid-template-columns:[^;}]*4\.8rem/s);
  assert.match(styles, /\.new-note-folder-copy\s*{[^}]*font-size:\s*0\.68rem/s);
});
