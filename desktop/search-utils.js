(function exposeSearchUtils(global) {
  "use strict";

  const ignoredCharacter = /[\s,./\\\p{Pd}]/u;

  function buildSearchIndex(parts) {
    let text = "";
    const positions = [];

    parts.forEach((value, partIndex) => {
      const part = String(value || "");
      let offset = 0;
      for (const character of part) {
        const start = offset;
        offset += character.length;
        for (const foldedCharacter of character.normalize("NFKC").toLocaleLowerCase()) {
          if (ignoredCharacter.test(foldedCharacter)) {
            continue;
          }
          text += foldedCharacter;
          positions.push({ partIndex, start, end: offset });
        }
      }
    });

    return { text, positions };
  }

  function normalizeSearchText(value) {
    return buildSearchIndex([value]).text;
  }

  function matchesSearchText(value, query) {
    const needle = normalizeSearchText(query);
    return Boolean(needle) && normalizeSearchText(value).includes(needle);
  }

  function findSearchMatches(parts, query) {
    const needle = normalizeSearchText(query);
    if (!needle) {
      return [];
    }

    const index = buildSearchIndex(parts);
    const matches = [];
    let from = 0;
    while (from <= index.text.length - needle.length) {
      const found = index.text.indexOf(needle, from);
      if (found === -1) {
        break;
      }
      const start = index.positions[found];
      const end = index.positions[found + needle.length - 1];
      matches.push({
        startPart: start.partIndex,
        startOffset: start.start,
        endPart: end.partIndex,
        endOffset: end.end,
      });
      from = found + needle.length;
    }
    return matches;
  }

  const api = { findSearchMatches, matchesSearchText, normalizeSearchText };
  global.NoteSearch = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
}(globalThis));
