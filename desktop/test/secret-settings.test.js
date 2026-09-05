const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeEncryptedApiKeys, publicApiKeySettings } = require("../secret-settings");

test("reports only API keys that were stored and validated", () => {
  assert.deepEqual(publicApiKeySettings({
    llm: {
      openaiApiKeyCipher: "encrypted-openai",
      openaiApiKeyValid: true,
      geminiApiKeyCipher: "encrypted-gemini",
      geminiApiKeyValid: false,
    },
  }), {
    hasOpenAiApiKey: true,
    hasGeminiApiKey: false,
  });
});

test("encrypts submitted API keys and never returns plaintext", async () => {
  const encrypted = await mergeEncryptedApiKeys({}, {
    openaiApiKey: "  sk-openai  ",
    geminiApiKey: "gemini-secret",
  }, async value => `cipher:${value}`, async () => true);

  assert.deepEqual(encrypted, {
    openaiApiKeyCipher: "cipher:sk-openai",
    openaiApiKeyValid: true,
    geminiApiKeyCipher: "cipher:gemini-secret",
    geminiApiKeyValid: true,
  });
  assert.equal(encrypted.openaiApiKey, undefined);
  assert.equal(encrypted.geminiApiKey, undefined);
});

test("blank API key fields keep the stored encrypted values", async () => {
  const previous = {
    llm: {
      openaiApiKeyCipher: "stored-openai",
      openaiApiKeyValid: true,
      geminiApiKeyCipher: "stored-gemini",
      geminiApiKeyValid: false,
    },
  };
  const encrypted = await mergeEncryptedApiKeys(previous, {
    openaiApiKey: "",
    geminiApiKey: "   ",
  }, async () => {
    throw new Error("blank keys must not be encrypted");
  }, async () => {
    throw new Error("blank keys must not be validated");
  });

  assert.deepEqual(encrypted, previous.llm);
});

test("does not encrypt or mark an API key when provider validation fails", async () => {
  let encrypted = false;
  await assert.rejects(
    mergeEncryptedApiKeys({}, {
      openaiApiKey: "invalid-key",
    }, async () => {
      encrypted = true;
      return "cipher";
    }, async () => {
      throw new Error("rejected by provider");
    }),
    /rejected by provider/,
  );
  assert.equal(encrypted, false);
});
