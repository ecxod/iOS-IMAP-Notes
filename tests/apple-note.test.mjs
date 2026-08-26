import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLE_NOTE_UTI,
  createAppleNoteDocument,
  isAppleNote,
  parseAppleNote,
  replaceAppleNoteBody,
} from "../scripts/apple-note.mjs";

function noteMessage(body, parts = null) {
  return {
    headers: {
      subject: ["Shopping"],
      "x-uniform-type-identifier": [APPLE_NOTE_UTI],
    },
    parts: parts || [{ contentType: "text/html; charset=utf-8", body }],
  };
}

test("recognizes only Apple IMAP notes", () => {
  assert.equal(isAppleNote(noteMessage("Shopping<div>Milk</div>")), true);
  assert.equal(isAppleNote({ headers: {}, parts: [] }), false);
});

test("keeps the complete HTML wrapper while replacing the message body", () => {
  const full = noteMessage(
    "<!DOCTYPE html>\r\n<html><head><style>b{color:red}</style></head>" +
    "<body class=\"note\">Shopping<div>Milk</div></body></html>",
  );
  const parsed = parseAppleNote(full);

  assert.equal(parsed.subject, "Shopping");
  assert.equal(parsed.bodyHtml, "Shopping<div>Milk</div>");
  assert.equal(
    replaceAppleNoteBody(parsed, "Shopping<div>Milk and bread</div>"),
    "<!DOCTYPE html>\r\n<html><head><style>b{color:red}</style></head>" +
      "<body class=\"note\">Shopping<div>Milk and bread</div></body></html>",
  );
});

test("finds an HTML note body in nested MIME parts", () => {
  const nested = noteMessage("", [
    {
      contentType: "multipart/alternative",
      parts: [
        { contentType: "text/plain", body: "Shopping\nMilk" },
        { contentType: "text/html", body: "Shopping<div>Milk</div>" },
      ],
    },
  ]);

  assert.equal(parseAppleNote(nested).bodyHtml, "Shopping<div>Milk</div>");
});

test("rejects regular messages and notes without a readable body", () => {
  assert.equal(parseAppleNote({ headers: {}, parts: [] }), null);
  assert.equal(parseAppleNote(noteMessage("", [])), null);
});

test("creates a minimal Apple-compatible HTML document and escapes its title", () => {
  const html = createAppleNoteDocument("One < Two & Three");
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /One &lt; Two &amp; Three<div><br><\/div>/);
  assert.doesNotMatch(html, /One < Two/);
});
