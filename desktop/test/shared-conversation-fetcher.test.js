const assert = require("node:assert/strict");
const test = require("node:test");
const { parseSharedUrl } = require("../conversation-import");
const {
  extractionScript,
  resolveSharedConversationUrl,
} = require("../shared-conversation-fetcher");

test("accepts only supported HTTPS provider share links", () => {
  assert.equal(parseSharedUrl("https://chatgpt.com/share/abc-123", "chatgpt").shareId, "abc-123");
  assert.equal(parseSharedUrl("https://share.gemini.google/C9IljMCVnZfE", "gemini").shareId, "C9IljMCVnZfE");
  assert.throws(() => parseSharedUrl("http://chatgpt.com/share/abc", "chatgpt"), /HTTPS/);
  assert.throws(() => parseSharedUrl("https://example.org/share/abc", "chatgpt"), /not a public/);
});

test("pre-resolves Gemini short links to a validated canonical share URL", async () => {
  const requested = parseSharedUrl("https://share.gemini.google/GxUjoTu8WNJW", "gemini");
  const resolved = await resolveSharedConversationUrl(requested, async (url, options) => {
    assert.equal(url, requested.url);
    assert.equal(options.method, "HEAD");
    assert.equal(options.redirect, "manual");
    return new Response(null, {
      status: 301,
      headers: {
        location: "https://gemini.google.com/share/305555208a68?skid=example",
      },
    });
  });
  assert.equal(resolved, "https://gemini.google.com/share/305555208a68?skid=example");
});

test("does not follow a Gemini short-link redirect outside the provider allowlist", async () => {
  const requested = parseSharedUrl("https://share.gemini.google/GxUjoTu8WNJW", "gemini");
  const resolved = await resolveSharedConversationUrl(requested, async () => new Response(null, {
    status: 302,
    headers: { location: "https://example.org/steal" },
  }));
  assert.equal(resolved, requested.url);
});

test("leaves canonical conversation URLs unchanged", async () => {
  const requested = parseSharedUrl("https://gemini.google.com/share/305555208a68", "gemini");
  const resolved = await resolveSharedConversationUrl(requested, async () => {
    assert.fail("canonical URLs must not be fetched by the redirect resolver");
  });
  assert.equal(resolved, requested.url);
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
