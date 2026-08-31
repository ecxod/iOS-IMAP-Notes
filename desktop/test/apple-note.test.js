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

test("parses an inline Apple image as editable rich content", async () => {
  const source = Buffer.from([
    "From: notes@example.net",
    "Subject: Photo note",
    "X-Uniform-Type-Identifier: com.apple.mail-note",
    "Content-Type: multipart/related; boundary=apple-note-test",
    "MIME-Version: 1.0",
    "",
    "--apple-note-test",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body>Photo<object type=\"application/x-apple-msg-attachment\" data=\"cid:photo@example\"></object></body></html>",
    "--apple-note-test",
    "Content-Type: image/png; name=photo.png",
    "Content-Disposition: inline; filename=photo.png",
    "Content-ID: <photo@example>",
    "Content-Transfer-Encoding: base64",
    "",
    "iVBORw==",
    "--apple-note-test--",
    "",
  ].join("\r\n"));

  const note = await parseAppleNoteSource(source, {
    accountId: "account-1",
    mailbox: "Notes",
    uid: 9,
    uidValidity: 10,
  });

  assert.equal(note.readOnly, false);
  assert.equal(note.images.length, 1);
  assert.equal(note.images[0].contentId, "photo@example");
  assert.equal(note.images[0].contentType, "image/png");
  assert.equal(note.images[0].dataBase64, "iVBORw==");
});

test("round-trips Apple image objects and multipart Content-IDs", async () => {
  const contentId = "PHOTO-1@mobilenotes.apple.com";
  const built = await buildAppleNoteSource({
    title: "Photo note",
    bodyHtml: `<div>Before<object type="application/x-apple-msg-attachment" data="cid:${contentId}"></object>After</div>`,
    images: [{
      contentId,
      contentType: "image/jpeg",
      filename: "image.jpeg",
      dataBase64: Buffer.from("jpeg data").toString("base64"),
    }],
    from: "notes@example.org",
  });
  const source = built.source.toString("utf8");
  assert.match(source, /Content-Type: multipart\/related/i);
  assert.match(source, /Content-ID: <PHOTO-1@mobilenotes\.apple\.com>/i);
  assert.match(source, /x-apple-part-url="PHOTO-1@mobilenotes\.apple\.com"/i);

  const note = await parseAppleNoteSource(built.source, {
    accountId: "personal",
    mailbox: "Notes",
    uid: 43,
    uidValidity: 7,
    internalDate: built.date,
  });
  assert.equal(note.readOnly, false);
  assert.equal(note.images.length, 1);
  assert.equal(note.images[0].dataBase64, Buffer.from("jpeg data").toString("base64"));
  assert.match(note.bodyHtml, /application\/x-apple-msg-attachment/);
});

test("keeps non-image attachments read-only", async () => {
  const source = Buffer.from([
    "From: notes@example.net",
    "Subject: Document note",
    "X-Uniform-Type-Identifier: com.apple.mail-note",
    "Content-Type: multipart/mixed; boundary=apple-note-test",
    "MIME-Version: 1.0",
    "",
    "--apple-note-test",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body>Document</body></html>",
    "--apple-note-test",
    "Content-Type: application/pdf; name=document.pdf",
    "Content-Disposition: attachment; filename=document.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERg==",
    "--apple-note-test--",
    "",
  ].join("\r\n"));
  const note = await parseAppleNoteSource(source, {
    accountId: "account-1",
    mailbox: "Notes",
    uid: 10,
    uidValidity: 10,
  });
  assert.equal(note.readOnly, true);
  assert.match(note.unsupportedReason, /non-image/);
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
