const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");

test("settings offer masked ChatGPT and Gemini API key inputs", async () => {
  const html = await readFile(path.join(desktopRoot, "index.html"), "utf8");
  for (const [id, label] of [
    ["openai-api-key", "ChatGPT / OpenAI API key"],
    ["gemini-api-key", "Gemini API key"],
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
