const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GEMINI_MODEL,
  OPENAI_MODEL,
  generateNoteReply,
} = require("../llm-client");

test("OpenAI Responses request sends note context without persisting the response", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          output: [{ content: [{ type: "output_text", text: "Revised paragraph" }] }],
        };
      },
    };
  };

  const result = await generateNoteReply({
    provider: "openai",
    apiKey: "openai-secret",
    title: "Project note",
    noteText: "Existing text",
    prompt: "Rewrite the last paragraph",
  }, fetchImpl);

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.Authorization, "Bearer openai-secret");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, OPENAI_MODEL);
  assert.equal(body.store, false);
  assert.match(body.input, /Existing text/);
  assert.match(body.input, /Rewrite the last paragraph/);
  assert.doesNotMatch(request.options.body, /openai-secret/);
  assert.deepEqual(result, {
    provider: "openai",
    providerLabel: "ChatGPT",
    model: OPENAI_MODEL,
    text: "Revised paragraph",
    html: "<p>Revised paragraph</p>\n",
  });
});

test("Gemini Interactions request returns model output without persisting it", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          steps: [{ type: "model_output", content: [{ type: "text", text: "Neue Fassung" }] }],
        };
      },
    };
  };

  const result = await generateNoteReply({
    provider: "gemini",
    apiKey: "gemini-secret",
    title: "Notiz",
    noteText: "Vorhandener Text",
    prompt: "Bitte fortsetzen",
  }, fetchImpl);

  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(request.options.headers["x-goog-api-key"], "gemini-secret");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, GEMINI_MODEL);
  assert.equal(body.store, false);
  assert.match(body.input, /Vorhandener Text/);
  assert.match(body.input, /Bitte fortsetzen/);
  assert.doesNotMatch(request.options.body, /gemini-secret/);
  assert.deepEqual(result, {
    provider: "gemini",
    providerLabel: "Gemini",
    model: GEMINI_MODEL,
    text: "Neue Fassung",
    html: "<p>Neue Fassung</p>\n",
  });
});

test("LLM requests reject missing keys, empty prompts and unsupported providers", async () => {
  await assert.rejects(
    generateNoteReply({ provider: "other", apiKey: "secret", prompt: "Hello" }),
    /Choose Gemini or ChatGPT/,
  );
  await assert.rejects(
    generateNoteReply({ provider: "gemini", apiKey: "", prompt: "Hello" }),
    /No Gemini API key/,
  );
  await assert.rejects(
    generateNoteReply({ provider: "openai", apiKey: "secret", prompt: "" }),
    /Enter a prompt/,
  );
});
