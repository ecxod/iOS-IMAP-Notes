const assert = require("node:assert/strict");
const test = require("node:test");
const {
  conversationMetadata,
  conversationNoteTitle,
  conversationSimilarity,
  isLikelyContinuation,
  mergeConversation,
  normalizeConversation,
  renderConversation,
} = require("../conversation-import");

function sharedConversation({
  provider = "gemini",
  shareId = "first-share",
  title = "Provider title that must be ignored",
  turns = [
    { id: "u1", role: "user", text: "Plan a safe import" },
    { id: "a1", role: "assistant", text: "Start with a snapshot." },
  ],
} = {}) {
  return normalizeConversation({
    provider,
    url: provider === "gemini"
      ? `https://gemini.google.com/share/${shareId}`
      : `https://chatgpt.com/share/${shareId}`,
    title,
    turns,
  });
}

test("normalizes only prompt and answer data, not the provider title", () => {
  const conversation = sharedConversation();
  assert.equal(Object.hasOwn(conversation, "sourceTitle"), false);
  assert.equal(conversationNoteTitle(conversation), "Plan a safe import");
  const html = renderConversation(conversation);
  assert.match(html, /Plan a safe import/);
  assert.match(html, /Start with a snapshot/);
  assert.doesNotMatch(html, /Provider title/);
  assert.doesNotMatch(html, /gemini\.google/);
});

test("recognizes a longer conversation only when the stored turns are its prefix", () => {
  const base = sharedConversation();
  const continuation = sharedConversation({
    shareId: "second-share",
    turns: [
      ...base.turns,
      { id: "u2", role: "user", text: "Continue" },
      { id: "a2", role: "assistant", text: "Continued" },
    ],
  });
  const forward = conversationSimilarity(base, continuation);
  assert.equal(isLikelyContinuation(forward), true);
  assert.equal(isLikelyContinuation(conversationSimilarity(continuation, base)), false);
});

test("keeps local edits and appends only new prompt and answer blocks", () => {
  const base = sharedConversation();
  const remote = sharedConversation({
    shareId: "second-share",
    turns: [
      ...base.turns,
      { id: "u2", role: "user", text: "Next prompt" },
      { id: "a2", role: "assistant", text: "Next answer" },
    ],
  });
  const merged = mergeConversation(base, {
    title: "My local title",
    bodyHtml: `${renderConversation(base)}\n<div>My local annotation</div>`,
  }, remote);
  assert.equal(merged.conflict, false);
  assert.equal(merged.title, "My local title");
  assert.equal(merged.appendedTurns, 2);
  assert.match(merged.bodyHtml, /My local annotation/);
  assert.match(merged.bodyHtml, /Next prompt/);
  assert.match(merged.bodyHtml, /Next answer/);
});

test("does not overwrite a local note when the remote history diverges", () => {
  const base = sharedConversation();
  const divergent = sharedConversation({
    shareId: "unrelated-share",
    turns: [
      { id: "u9", role: "user", text: "Different prompt" },
      { id: "a9", role: "assistant", text: "Different answer" },
    ],
  });
  const localBody = `${renderConversation(base)}<div>Local edit</div>`;
  const merged = mergeConversation(base, { title: "Local", bodyHtml: localBody }, divergent);
  assert.equal(merged.conflict, true);
  assert.equal(merged.bodyHtml, localBody);
});

test("stores technical identity separately from note content", () => {
  const remote = sharedConversation();
  const metadata = conversationMetadata(null, remote, "12345678-abcd-4321-abcd-123456789abc");
  assert.deepEqual(metadata.shareIds, ["first-share"]);
  assert.equal(metadata.provider, "gemini");
  assert.equal(renderConversation(remote).includes(metadata.latestShareUrl), false);
});
