const assert = require("node:assert/strict");
const test = require("node:test");
const { markdownToHtml } = require("../markdown-utils");

test("converts common LLM Markdown to rich note HTML", async () => {
  const html = await markdownToHtml([
    "# Result",
    "",
    "- **Bold** item",
    "- [x] Finished",
    "",
    "```js",
    "const answer = 42;",
    "```",
    "",
    "| Name | Value |",
    "| --- | ---: |",
    "| Answer | 42 |",
  ].join("\n"));

  assert.match(html, /<h1>Result<\/h1>/);
  assert.match(html, /<ul>[\s\S]*<strong>Bold<\/strong> item/);
  assert.match(html, /☑ Finished/);
  assert.match(html, /<pre><code class="language-js">const answer = 42;/);
  assert.match(html, /<table>[\s\S]*<th>Name<\/th>[\s\S]*<td align="right">42<\/td>/);
});

test("escapes raw HTML and does not embed Markdown images", async () => {
  const html = await markdownToHtml([
    "<script>alert('no')</script>",
    "",
    "![remote](https://example.invalid/tracker.png)",
  ].join("\n"));

  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /\[Image: remote\]/);
});
