const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeEncryptedApiKeys, publicApiKeySettings } = require("../secret-settings");

test("reports only whether API keys are stored", () => {
  assert.deepEqual(publicApiKeySettings({
    llm: {
      openaiApiKeyCipher: "encrypted-openai",
      geminiApiKeyCipher: "encrypted-gemini",
    },
  }), {
    hasOpenAiApiKey: true,
    hasGeminiApiKey: true,
  });
});

test("encrypts submitted API keys and never returns plaintext", async () => {
  const encrypted = await mergeEncryptedApiKeys({}, {
    openaiApiKey: "  sk-openai  ",
    geminiApiKey: "gemini-secret",
  }, async value => `cipher:${value}`);

  assert.deepEqual(encrypted, {
    openaiApiKeyCipher: "cipher:sk-openai",
    geminiApiKeyCipher: "cipher:gemini-secret",
  });
  assert.equal(encrypted.openaiApiKey, undefined);
  assert.equal(encrypted.geminiApiKey, undefined);
});

test("blank API key fields keep the stored encrypted values", async () => {
  const previous = {
    llm: {
      openaiApiKeyCipher: "stored-openai",
      geminiApiKeyCipher: "stored-gemini",
    },
  };
  const encrypted = await mergeEncryptedApiKeys(previous, {
    openaiApiKey: "",
    geminiApiKey: "   ",
  }, async () => {
    throw new Error("blank keys must not be encrypted");
  });

  assert.deepEqual(encrypted, previous.llm);
});
