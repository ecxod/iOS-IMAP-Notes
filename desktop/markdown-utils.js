"use strict";

let markedModulePromise = null;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadMarked() {
  markedModulePromise ||= import("marked");
  return markedModulePromise;
}

async function markdownToHtml(value, moduleLoader = loadMarked) {
  const { Marked } = await moduleLoader();
  const parser = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      checkbox({ checked }) {
        return checked ? "☑ " : "☐ ";
      },
      html({ text }) {
        return escapeHtml(text);
      },
      image({ text }) {
        return escapeHtml(text ? `[Image: ${text}]` : "[Image]");
      },
    },
  });
  return String(parser.parse(String(value || ""), { async: false }));
}

module.exports = {
  escapeHtml,
  markdownToHtml,
};
