(function initMarkdownSource(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NoteMarkdownSource = api;
  }
}(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "FOOTER", "H1", "H2", "H3",
    "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "P", "PRE", "SECTION",
    "TABLE", "TR",
  ]);

  function appendLineBreak(parts) {
    const last = parts.at(-1) || "";
    if (!last.endsWith("\n")) {
      parts.push("\n");
    }
  }

  function collectText(node, parts) {
    if (node?.nodeType === 3) {
      parts.push(String(node.nodeValue || "").replaceAll("\u00a0", " "));
      return;
    }
    const tagName = String(node?.tagName || "").toUpperCase();
    if (tagName === "BR") {
      parts.push("\n");
      return;
    }
    for (const child of node?.childNodes || []) {
      collectText(child, parts);
    }
    if (BLOCK_TAGS.has(tagName)) {
      appendLineBreak(parts);
    }
  }

  function extractMarkdownText(rootNode) {
    const parts = [];
    collectText(rootNode, parts);
    return parts.join("")
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .replace(/^\n+|\n+$/g, "");
  }

  return { extractMarkdownText };
}));
