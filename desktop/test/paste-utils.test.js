const assert = require("node:assert/strict");
const test = require("node:test");
const { plainTextToHtml } = require("../paste-utils");

test("escapes clipboard HTML instead of inserting it as markup", () => {
  assert.equal(
    plainTextToHtml('<a href="https://example.org">Example & more</a>'),
    '&lt;a href="https://example.org"&gt;Example &amp; more&lt;/a&gt;',
  );
});

test("preserves Windows and Unix line breaks without carrying formatting", () => {
  assert.equal(plainTextToHtml("First\r\nSecond\n\nFourth"), "First<br>Second<br><br>Fourth");
});
