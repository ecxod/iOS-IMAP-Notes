const assert = require("node:assert/strict");
const test = require("node:test");
const {
  findSearchMatches,
  matchesSearchText,
  normalizeSearchText,
} = require("../search-utils");

test("ignores spaces, line breaks, and common separators", () => {
  for (const value of [
    "0172 9203549",
    "0172\n9203549",
    "0172-9203549",
    "0172/9203549",
    "0172,9203549",
  ]) {
    assert.equal(matchesSearchText(value, "01729203549"), true, value);
  }
});

test("ignores separators in either the query or the note", () => {
  assert.equal(matchesSearchText("ANNAMARIA", "ANNA MARIA"), true);
  assert.equal(matchesSearchText("ANNA\nmaria", "ANNAMARIA"), true);
  assert.equal(matchesSearchText("Anna-Maria", "anna/maria"), true);
  assert.equal(matchesSearchText("Anna Schmidt", "Anna Maria"), false);
  assert.equal(normalizeSearchText("Änne–Marie"), "ännemarie");
});

test("returns highlight offsets across text nodes and ignored characters", () => {
  assert.deepEqual(findSearchMatches(["Vor ANNA", "\n", "maria nach"], "anna maria"), [{
    startPart: 0,
    startOffset: 4,
    endPart: 2,
    endOffset: 5,
  }]);
});
