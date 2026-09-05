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
  const gemini = extractionScript("gemini", [{
    assistantIndex: 0,
    chipIndex: 0,
    links: [{ text: "Umweltbundesamt", href: "https://example.org/source" }],
  }]);
  const chatgpt = extractionScript("chatgpt");
  assert.match(gemini, /share-turn-viewer/);
  assert.match(gemini, /query-text-line/);
  assert.match(gemini, /assistantHtml/);
  assert.match(gemini, /sourceBlocks/);
  assert.match(gemini, /!sourceBlock\?\.innerText\?\.trim\(\)/);
  assert.match(gemini, /code\.textContent = codeText/);
  assert.match(gemini, /Generated file: /);
  assert.match(gemini, /Umweltbundesamt/);
  assert.match(gemini, /https:\/\/example\.org\/source/);
  assert.match(chatgpt, /data-message-author-role/);
  assert.match(chatgpt, /innerHTML/);
  assert.doesNotThrow(() => new Function(`return ${gemini};`));
  assert.doesNotThrow(() => new Function(`return ${chatgpt};`));
  assert.doesNotMatch(gemini, /og:title|document\.title/);
  assert.doesNotMatch(chatgpt, /og:title|document\.title/);
});
