const test = require("node:test");
const assert = require("node:assert/strict");
const { accountTarget, noteTarget, scopeForNote } = require("../tab-utils");

test("notes are assigned to their local or IMAP account scope", () => {
  assert.equal(scopeForNote({ home: { kind: "local" } }), "local");
  assert.equal(scopeForNote({ home: { kind: "imap", accountId: "work" } }), "work");
});

test("opening a note activates an existing tab or reuses the active matching empty tab", () => {
  const tabs = [
    { id: "one", noteId: "note-1", scope: "work" },
    { id: "empty", noteId: null, scope: "private" },
  ];
  assert.deepEqual(noteTarget(tabs, "empty", { id: "note-1", home: { kind: "imap", accountId: "work" } }), {
    action: "activate",
    tabId: "one",
  });
  assert.deepEqual(noteTarget(tabs, "empty", { id: "note-2", home: { kind: "imap", accountId: "private" } }), {
    action: "reuse",
    tabId: "empty",
  });
  assert.deepEqual(noteTarget(tabs, "one", { id: "note-3", home: { kind: "local" } }), {
    action: "create",
    tabId: null,
  });
});

test("an account change creates an empty tab when the active tab belongs elsewhere", () => {
  const tabs = [
    { id: "work-note", noteId: "note-1", scope: "work" },
    { id: "private-empty", noteId: null, scope: "private" },
  ];
  assert.deepEqual(accountTarget(tabs, "work-note", "work"), { action: "none", tabId: "work-note" });
  assert.deepEqual(accountTarget(tabs, "work-note", "private"), { action: "create", tabId: null });
  assert.deepEqual(accountTarget(tabs, "work-note", "local"), { action: "create", tabId: null });
  assert.deepEqual(accountTarget(tabs, "work-note", "all"), { action: "none", tabId: null });
});
