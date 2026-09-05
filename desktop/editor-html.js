(function exposeEditorHtml(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NoteEditorHtml = api;
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  function meaningfulSibling(node, direction) {
    let sibling = node[direction];
    while (sibling && (sibling.nodeType === 8
        || (sibling.nodeType === 3 && !sibling.textContent.trim()))) {
      sibling = sibling[direction];
    }
    return sibling;
  }

  function normalizeListItemBlocks(root) {
    const selector = "p, div, h1, h2, h3, h4, h5, h6, blockquote, pre";
    for (const listItem of root.querySelectorAll("li")) {
      const blocks = [...listItem.querySelectorAll(selector)]
        .filter(element => {
          if (element.closest("li") !== listItem) return false;
          const tableCell = element.closest("td, th");
          return !tableCell || !listItem.contains(tableCell);
        })
        .reverse();
      for (const block of blocks) {
        const documentObject = block.ownerDocument;
        const replacement = documentObject.createDocumentFragment();
        const previous = meaningfulSibling(block, "previousSibling");
        const next = meaningfulSibling(block, "nextSibling");
        if (previous && previous.nodeName !== "BR") {
          replacement.append(documentObject.createElement("br"));
        }
        if (/^H[1-6]$/.test(block.nodeName)) {
          const strong = documentObject.createElement("strong");
          strong.append(...block.childNodes);
          replacement.append(strong);
        } else if (block.nodeName === "PRE") {
          const code = documentObject.createElement("code");
          code.append(...block.childNodes);
          replacement.append(code);
        } else {
          replacement.append(...block.childNodes);
        }
        if (next && next.nodeName !== "BR" && !["UL", "OL"].includes(next.nodeName)) {
          replacement.append(documentObject.createElement("br"));
        }
        block.replaceWith(replacement);
      }
    }
    return root;
  }

  function normalizeForSunEditor(html, documentObject) {
    const browserDocument = documentObject || globalThis.document;
    if (!browserDocument?.createElement) {
      throw new TypeError("A browser document is required to normalize editor HTML.");
    }
    const template = browserDocument.createElement("template");
    template.innerHTML = String(html || "");
    normalizeListItemBlocks(template.content);
    return template.innerHTML;
  }

  return Object.freeze({ normalizeForSunEditor, normalizeListItemBlocks });
});
