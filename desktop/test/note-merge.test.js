const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeNoteVersions } = require("../note-merge");

function note(id, bodyHtml, updatedAt, images = []) {
  return { id, title: "Wise Iban", bodyHtml, updatedAt, images };
}

test("keeps the selected target first and appends distinct versions", () => {
  const result = mergeNoteVersions([
    note("old", "<p>Old account</p>", 1),
    note("target", "<p>Current account</p>", 3),
    note("middle", "<p>Middle account</p>", 2),
  ], "target", () => "unused");
  assert.match(result.bodyHtml, /^<p>Current account<\/p><hr>/);
  assert.ok(result.bodyHtml.indexOf("Old account") < result.bodyHtml.indexOf("Middle account"));
  assert.equal(result.includedVersions, 3);
});

test("does not repeat an exact duplicate version", () => {
  const result = mergeNoteVersions([
    note("target", "<p>Same</p>", 3),
    note("duplicate", "<p>Same</p>", 2),
  ], "target", () => "unused");
  assert.equal(result.bodyHtml, "<p>Same</p>");
  assert.equal(result.includedVersions, 1);
  assert.equal(result.skippedDuplicates, 1);
});

test("remaps colliding image content IDs without dropping either image", () => {
  const first = { contentId: "photo@example", contentType: "image/png", dataBase64: "AAAA" };
  const second = { contentId: "photo@example", contentType: "image/png", dataBase64: "BBBB" };
  const result = mergeNoteVersions([
    note("target", '<object data="cid:photo@example"></object>', 2, [first]),
    note("other", '<object data="cid:photo@example"></object>', 1, [second]),
  ], "target", () => "new-id");
  assert.equal(result.images.length, 2);
  assert.match(result.bodyHtml, /cid:photo@example/);
  assert.match(result.bodyHtml, /cid:new-id@merged\.notes/);
});
