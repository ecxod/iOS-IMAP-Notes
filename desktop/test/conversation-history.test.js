const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const git = require("isomorphic-git");
const {
  commitConversationVersion,
  readConversationState,
} = require("../conversation-history");

test("creates a private local Git history for imported and edited notes", async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "ios-notes-history-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const conversationId = "12345678-abcd-4321-abcd-123456789abc";
  const snapshot = {
    provider: "gemini",
    shareId: "share-one",
    turns: [
      { role: "user", text: "Prompt", hash: "u" },
      { role: "assistant", text: "Answer", hash: "a" },
    ],
    revision: "revision-one",
  };
  const first = await commitConversationVersion(root, {
    conversationId,
    provider: "gemini",
    shareIds: ["share-one"],
    snapshot,
    note: { id: "note-1", title: "Local title", bodyHtml: "<p>Prompt and answer</p>", updatedAt: 1, home: { kind: "local" } },
    message: "Import conversation",
  });
  const second = await commitConversationVersion(root, {
    conversationId,
    provider: "gemini",
    shareIds: ["share-one"],
    snapshot,
    note: { id: "note-1", title: "Renamed locally", bodyHtml: "<p>Locally edited</p>", updatedAt: 2, home: { kind: "local" } },
    message: "Edit conversation",
  });

  assert.notEqual(first.oid, second.oid);
  const state = await readConversationState(root, conversationId);
  assert.equal(state.note.title, "Renamed locally");
  assert.equal(state.snapshot.shareId, "share-one");
  const commits = await git.log({ fs, dir: root });
  assert.equal(commits.length, 2);
  assert.deepEqual(commits.map(item => item.commit.message.trim()), ["Edit conversation", "Import conversation"]);
  assert.match(await fsp.readFile(path.join(root, "README.txt"), "utf8"), /Do not publish/);
});
