const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");

test("settings offer masked OpenAI and Gemini API key inputs", async () => {
  const html = await readFile(path.join(desktopRoot, "index.html"), "utf8");
  for (const [id, label] of [
    ["openai-api-key", "ChatGPT API key"],
    ["gemini-api-key", "Gemini API key"],
  ]) {
    assert.match(html, new RegExp(`<input id="${id}"[^>]*type="password"[^>]*aria-label="${label}"`));
  }
  assert.doesNotMatch(html, /<label>\s*(?:OpenAI )?API key/);
});

test("settings offer Electron diagnostics and browser developer tools", async () => {
  const html = await readFile(path.join(__dirname, "..", "index.html"), "utf8");
  const main = await readFile(path.join(__dirname, "..", "main.js"), "utf8");
  const renderer = await readFile(path.join(__dirname, "..", "renderer.js"), "utf8");
  const preload = await readFile(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.match(html, /id="sentry-dsn"[^>]*type="url"/);
  assert.match(html, /id="open-dev-tools"/);
  assert.match(renderer, /diagnostics:\s*{\s*sentryDsn: sentryDsn\.value/);
  assert.match(renderer, /notesApi\.diagnostics\.openDevTools/);
  assert.match(renderer, /Restart the app to apply the Sentry DSN/);
  assert.match(preload, /diagnostics:open-dev-tools/);
  assert.match(preload, /diagnostics:renderer-error/);
  assert.ok(
    main.indexOf("initializeSentryBeforeReady();") < main.indexOf("app.whenReady()"),
    "Sentry must be initialized before Electron emits ready",
  );
  const readyHandler = main.slice(main.indexOf("app.whenReady()"));
  assert.doesNotMatch(readyHandler, /Sentry\.init\(/);
});

test("renderer submits API keys without receiving stored plaintext", async () => {
  const [renderer, styles] = await Promise.all([
    readFile(path.join(desktopRoot, "renderer.js"), "utf8"),
    readFile(path.join(desktopRoot, "styles.css"), "utf8"),
  ]);
  assert.match(renderer, /llm:\s*{\s*openaiApiKey: openAiApiKey\.value,\s*geminiApiKey: geminiApiKey\.value/);
  assert.match(renderer, /settings\.llm\?\.hasOpenAiApiKey/);
  assert.match(renderer, /settings\.llm\?\.hasGeminiApiKey/);
  assert.match(renderer, /input\.placeholder = hasValidStoredKey \? "••••••••  Valid" : "Enter API key"/);
  assert.match(renderer, /classList\.toggle\("has-valid-secret", hasValidStoredKey\)/);
  assert.match(renderer, /classList\.toggle\("has-pending-secret", hasCandidate\)/);
  assert.match(renderer, /message\.includes\("API key validation failed"\)[\s\S]*await loadSettings\(\)/);
  assert.match(styles, /input\.has-valid-secret\s*{[^}]*border-color:\s*#287c3e/s);
  assert.match(styles, /input\.has-pending-secret\s*{[^}]*border-color:\s*#a55000/s);
});

test("editor shows a growing AI prompt bar only for configured providers", async () => {
  const [html, preload, renderer, styles] = await Promise.all([
    readFile(path.join(desktopRoot, "index.html"), "utf8"),
    readFile(path.join(desktopRoot, "preload.js"), "utf8"),
    readFile(path.join(desktopRoot, "renderer.js"), "utf8"),
    readFile(path.join(desktopRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /<form id="ai-compose" hidden>[\s\S]*id="ai-provider"[\s\S]*id="ai-prompt"[\s\S]*id="ai-submit"/);
  assert.match(preload, /llm:ask/);
  assert.match(renderer, /llmSettings\?\.hasGeminiApiKey/);
  assert.match(renderer, /llmSettings\?\.hasOpenAiApiKey/);
  assert.match(renderer, /notesApi\.llm\.ask/);
  assert.match(renderer, /setStatus\(aiState, errorText\(error\)\);[\s\S]*await loadSettings\(\)/);
  assert.match(renderer, /selectedText = selectedEditorText\(requestedRange\)/);
  assert.match(renderer, /insertionRange\?\.collapse\(false\)/);
  assert.match(renderer, /selectedText,/);
  assert.match(renderer, /restoreEditorInsertionPoint\(insertionRange\)/);
  assert.match(renderer, /editor\.insertHTML\(aiExchangeHtml/);
  assert.match(renderer, /setStatus\(aiState, "Inserted at the cursor position\. Saving…", "working"\);[\s\S]*await saveNote\(\)/);
  assert.match(renderer, /"Inserted at the cursor position and saved\."/);
  assert.doesNotMatch(renderer, /Save the note to keep it/);
  assert.match(renderer, /sanitizeGeneratedMarkdownHtml\(responseHtml\)/);
  assert.match(renderer, /result\.html \|\| NotePaste\.plainTextToHtml\(result\.text\)/);
  assert.match(renderer, /selected\?\.id !== requestedNoteId \|\| activeTabId !== requestedTabId/);
  assert.match(styles, /#ai-compose\s*{[^}]*width:\s*100%[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(styles, /#ai-prompt\s*{[^}]*max-height:[^}]*resize:\s*none/s);
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
