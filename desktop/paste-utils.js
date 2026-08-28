(function exposePasteUtils(global) {
  "use strict";

  function plainTextToHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replace(/\r\n?|\n/g, "<br>");
  }

  const api = { plainTextToHtml };
  global.NotePaste = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
}(globalThis));
