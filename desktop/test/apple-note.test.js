const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAppleNoteSource,
  extractBody,
  noteId,
  parseAppleNoteSource,
  sourceRevision,
} = require("../apple-note");

test("builds and parses an Apple IMAP note without losing Unicode", async () => {
  const built = await buildAppleNoteSource({
    title: "Äpfel & Brot",
    bodyHtml: "<div>Milch und Käse</div>",
    from: "notes@example.org",
  });
  const note = await parseAppleNoteSource(built.source, {
    accountId: "personal",
    mailbox: "Notes",
    uid: 42,
    uidValidity: 7,
    internalDate: built.date,
  });

  assert.equal(note.title, "Äpfel & Brot");
  assert.equal(note.bodyHtml, "<div>Milch und Käse</div>");
  assert.match(note.searchText, /käse/);
  assert.equal(note.home.accountId, "personal");
  assert.equal(note.home.mailbox, "Notes");
  assert.equal(note.home.uid, "42");
  assert.equal(note.home.uuid, built.uuid);
});

test("uses the Apple UUID as the stable mixed-list identity", () => {
  const first = noteId("work", "Notes", "ABC-123", "4", "10");
  const replacement = noteId("work", "Notes", "ABC-123", "4", "11");
  const otherAccount = noteId("private", "Notes", "ABC-123", "4", "11");

  assert.equal(first, replacement);
  assert.notEqual(first, otherAccount);
});

test("detects source changes for optimistic IMAP save protection", () => {
  assert.equal(sourceRevision("same"), sourceRevision(Buffer.from("same")));
  assert.notEqual(sourceRevision("before"), sourceRevision("after"));
});

test("extracts only the editable HTML body", () => {
  assert.equal(
    extractBody('<!doctype html><html><head><style>b{color:red}</style></head><body class="note"><b>Hello</b></body></html>'),
    "<b>Hello</b>",
  );
});

test("rejects ordinary email messages", async () => {
  const ordinary = Buffer.from([
    "From: sender@example.org",
    "Subject: Mail",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<div>Not a note</div>",
  ].join("\r\n"));
  assert.equal(await parseAppleNoteSource(ordinary, {
    accountId: "a",
    mailbox: "INBOX",
    uid: 1,
    uidValidity: 1,
  }), null);
});
