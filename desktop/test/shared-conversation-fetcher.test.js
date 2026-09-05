const assert = require("node:assert/strict");
const test = require("node:test");
const { parseSharedUrl } = require("../conversation-import");
const { extractionScript } = require("../shared-conversation-fetcher");

test("accepts only supported HTTPS provider share links", () => {
  assert.equal(parseSharedUrl("https://chatgpt.com/share/abc-123", "chatgpt").shareId, "abc-123");
  assert.equal(parseSharedUrl("https://share.gemini.google/C9IljMCVnZfE", "gemini").shareId, "C9IljMCVnZfE");
  assert.throws(() => parseSharedUrl("http://chatgpt.com/share/abc", "chatgpt"), /HTTPS/);
  assert.throws(() => parseSharedUrl("https://example.org/share/abc", "chatgpt"), /not a public/);
});

test("extractors read message roles and text without page title metadata", () => {
  const gemini = extractionScript("gemini");
  const chatgpt = extractionScript("chatgpt");
  assert.match(gemini, /share-turn-viewer/);
  assert.match(gemini, /query-text-line/);
  assert.match(chatgpt, /data-message-author-role/);
  assert.doesNotMatch(gemini, /og:title|document\.title/);
  assert.doesNotMatch(chatgpt, /og:title|document\.title/);
});
