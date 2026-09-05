const API_KEY_FIELDS = [
  {
    input: "openaiApiKey",
    cipher: "openaiApiKeyCipher",
    publicFlag: "hasOpenAiApiKey",
  },
  {
    input: "geminiApiKey",
    cipher: "geminiApiKeyCipher",
    publicFlag: "hasGeminiApiKey",
  },
];

function llmSettings(value) {
  return value?.llm && typeof value.llm === "object" ? value.llm : {};
}

function publicApiKeySettings(settings) {
  const stored = llmSettings(settings);
  return Object.fromEntries(API_KEY_FIELDS.map(field => [
    field.publicFlag,
    Boolean(stored[field.cipher]),
  ]));
}

async function mergeEncryptedApiKeys(previousSettings, input, encrypt) {
  if (typeof encrypt !== "function") {
    throw new TypeError("An encryption function is required.");
  }
  const previous = llmSettings(previousSettings);
  const submitted = input && typeof input === "object" ? input : {};
  const next = { ...previous };
  for (const field of API_KEY_FIELDS) {
    const apiKey = String(submitted[field.input] || "").trim();
    if (apiKey) {
      next[field.cipher] = await encrypt(apiKey);
    }
  }
  return next;
}

module.exports = {
  mergeEncryptedApiKeys,
  publicApiKeySettings,
};
