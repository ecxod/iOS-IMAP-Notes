import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppleAttachmentObject,
  createRawAppleNoteMessage,
} from "../scripts/rfc822.mjs";

const baseHeaders = {
  from: ["Jörg Beispiel <notes@example.net>"],
  subject: ["Einkäufe für nächste Woche"],
  date: ["Wed, 26 Aug 2026 15:25:45 GMT"],
  "message-id": ["<note@example.net>"],
  "x-uniform-type-identifier": ["com.apple.mail-note"],
};

test("builds a reviewable Apple note message with encoded Unicode headers", () => {
  const raw = createRawAppleNoteMessage(baseHeaders, "<html><body>Äpfel</body></html>");

  assert.match(raw, /^From: =\?UTF-8\?B\?.+\?= <notes@example\.net>\r$/m);
  assert.match(raw, /^Subject: =\?UTF-8\?B\?.+\?=\r$/m);
  assert.match(raw, /^X-Uniform-Type-Identifier: com\.apple\.mail-note\r$/m);
  assert.match(raw, /^MIME-Version: 1\.0\r$/m);
  assert.match(raw, /^Content-Type: text\/html; charset=UTF-8\r$/m);
  assert.ok(raw.endsWith("\r\n\r\n<html><body>Äpfel</body></html>"));
});

test("does not copy transport headers and prevents header injection", () => {
  const raw = createRawAppleNoteMessage({
    ...baseHeaders,
    subject: ["Safe\r\nBcc: injected@example.net"],
    "content-type": ["application/x-unwanted"],
    "x-mozilla-status": ["0001"],
  }, "Body");

  assert.doesNotMatch(raw, /^Bcc:/m);
  assert.doesNotMatch(raw, /application\/x-unwanted/);
  assert.doesNotMatch(raw, /X-Mozilla-Status/i);
  assert.match(raw, /Content-Type: text\/html; charset=UTF-8/);
});

test("rejects invalid header names and missing required headers", () => {
  assert.throws(
    () => createRawAppleNoteMessage({ ...baseHeaders, "Bad Header": ["x"] }, "Body"),
    /Invalid message header name/,
  );
  assert.throws(
    () => createRawAppleNoteMessage({ subject: ["Note"] }, "Body"),
    /From header is required/,
  );
});

test("allows a note with an empty subject", () => {
  const raw = createRawAppleNoteMessage({ ...baseHeaders, subject: [""] }, "Body");
  assert.match(raw, /^Subject: \r$/m);
});

test("builds the multipart/related format used by iOS attachment notes", () => {
  const contentId = "PHOTO-1@mobilenotes.apple.com";
  const html = `<html><body>Photo${createAppleAttachmentObject(contentId)}</body></html>`;
  const raw = createRawAppleNoteMessage(baseHeaders, html, [{
    filename: "photo.png",
    contentType: "image/png",
    contentId,
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  }]);

  assert.match(raw, /^Content-Type: multipart\/related; type="text\/html"; boundary="Apple-Mail-[^"]+"\r$/m);
  assert.match(raw, /type="application\/x-apple-msg-attachment" data="cid:PHOTO-1@mobilenotes\.apple\.com"/);
  assert.match(raw, /^Content-Type: image\/png; name="photo\.png"; x-apple-part-url="PHOTO-1@mobilenotes\.apple\.com"\r$/m);
  assert.match(raw, /^Content-Disposition: inline; filename="photo\.png"\r$/m);
  assert.match(raw, /^Content-ID: <PHOTO-1@mobilenotes\.apple\.com>\r$/m);
  assert.match(raw, /\r\niVBORw==\r\n--Apple-Mail-/);
});

test("rejects malformed attachment metadata", () => {
  assert.throws(
    () => createRawAppleNoteMessage(baseHeaders, "Body", [{
      filename: "bad.bin",
      contentType: "not a MIME type",
      data: new Uint8Array([1]),
    }]),
    /Invalid attachment content type/,
  );
});
