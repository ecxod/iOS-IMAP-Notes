const test = require("node:test");
const assert = require("node:assert/strict");
const { extractMarkdownText } = require("../markdown-source");

function text(value) {
  return { nodeType: 3, nodeValue: value, childNodes: [] };
}

function element(tagName, ...childNodes) {
  return { nodeType: 1, tagName, childNodes };
}

function fragment(...childNodes) {
  return { nodeType: 11, childNodes };
}

test("restores Markdown line structure from rich-editor blocks", () => {
  const source = extractMarkdownText(fragment(
    element("DIV", text("# Heading")),
    element("DIV", element("BR")),
    element("DIV", text("- **First** item")),
    element("DIV", text("- Second item")),
  ));
  assert.equal(source, "# Heading\n\n- **First** item\n- Second item");
});

test("keeps inline text together and explicit line breaks intact", () => {
  const source = extractMarkdownText(fragment(
    element("P", text("A "), element("SPAN", text("[link](https://example.org)"))),
    element("P", text("line one"), element("BR"), text("line two\u00a0here")),
  ));
  assert.equal(source, "A [link](https://example.org)\nline one\nline two here");
});
