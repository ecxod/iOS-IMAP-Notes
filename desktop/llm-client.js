"use strict";

const MAX_PROMPT_LENGTH = 20_000;
const MAX_NOTE_CONTEXT_LENGTH = 60_000;
const REQUEST_TIMEOUT = 90_000;
const OPENAI_MODEL = "gpt-5.6-luna";
const GEMINI_MODEL = "gemini-3.7-flash";

function collaborationInput({ title, noteText, prompt }) {
  const safeTitle = String(title || "Untitled note").slice(0, 500);
  const safeNote = String(noteText || "").slice(-MAX_NOTE_CONTEXT_LENGTH);
  return [
    `Current note title: ${safeTitle}`,
    "",
    "Current note content:",
    safeNote || "(empty)",
    "",
    "User request:",
    prompt,
  ].join("\n");
}

function responseError(providerLabel, response, data) {
  const detail = String(
    data?.error?.message
      || data?.errors?.[0]?.message
      || data?.message
      || "",
  ).replace(/\s+/g, " ").trim().slice(0, 500);
  return new Error(`${providerLabel} request failed (${response.status})${detail ? `: ${detail}` : "."}`);
}

async function requestJson(providerLabel, url, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    let data = null;
    try {
      data = await response.json();
    } catch {
      // The status code below still provides a useful error for non-JSON responses.
    }
    if (!response.ok) {
      throw responseError(providerLabel, response, data);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${providerLabel} request timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function openAiText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  return (Array.isArray(data?.output) ? data.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && typeof item.text === "string")
    .map(item => item.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function geminiText(data) {
  return (Array.isArray(data?.steps) ? data.steps : [])
    .filter(step => step?.type === "model_output")
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(item => item?.type === "text" && typeof item.text === "string")
    .map(item => item.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function generateNoteReply(input, fetchImpl = globalThis.fetch) {
  const provider = String(input?.provider || "").toLowerCase();
  const apiKey = String(input?.apiKey || "").trim();
  const prompt = String(input?.prompt || "").trim();
  if (!["openai", "gemini"].includes(provider)) {
    throw new Error("Choose Gemini or ChatGPT.");
  }
  if (!apiKey) {
    throw new Error(`No ${provider === "gemini" ? "Gemini" : "OpenAI"} API key is stored.`);
  }
  if (!prompt) {
    throw new Error("Enter a prompt.");
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`The prompt is longer than ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters.`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("This Electron version does not provide secure API requests.");
  }
  const requestInput = collaborationInput({
    title: input?.title,
    noteText: input?.noteText,
    prompt,
  });
  if (provider === "openai") {
    const data = await requestJson("ChatGPT", "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: "Collaborate on the user's note. Return only the useful text to insert into the note, without a preamble.",
        input: requestInput,
        max_output_tokens: 4_000,
        store: false,
      }),
    }, fetchImpl);
    const text = openAiText(data);
    if (!text) {
      throw new Error("ChatGPT returned no text.");
    }
    return { provider, providerLabel: "ChatGPT", model: OPENAI_MODEL, text };
  }

  const data = await requestJson("Gemini", "https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      system_instruction: "Collaborate on the user's note. Return only the useful text to insert into the note, without a preamble.",
      input: requestInput,
      store: false,
      generation_config: { max_output_tokens: 4_000 },
    }),
  }, fetchImpl);
  const text = geminiText(data);
  if (!text) {
    throw new Error("Gemini returned no text.");
  }
  return { provider, providerLabel: "Gemini", model: GEMINI_MODEL, text };
}

module.exports = {
  GEMINI_MODEL,
  MAX_PROMPT_LENGTH,
  OPENAI_MODEL,
  collaborationInput,
  generateNoteReply,
  geminiText,
  openAiText,
};
