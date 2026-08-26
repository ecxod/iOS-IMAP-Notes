import assert from "node:assert/strict";
import test from "node:test";

import { createRawAppleNoteMessage } from "../scripts/rfc822.mjs";

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
