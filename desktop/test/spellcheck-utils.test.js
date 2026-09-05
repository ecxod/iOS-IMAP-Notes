const assert = require("node:assert/strict");
const test = require("node:test");
const {
  commonSpellcheckLanguages,
  matchingLanguage,
  resolveSpellcheckSettings,
} = require("../spellcheck-utils");

const available = ["de-DE", "de-CH", "en-GB", "en-US", "es-ES", "fr-FR", "uk"];

test("matches exact locales and falls back to an available regional dictionary", () => {
  assert.equal(matchingLanguage(available, "de_CH"), "de-CH");
  assert.equal(matchingLanguage(available, "es-MX"), "es-ES");
  assert.equal(matchingLanguage(available, "nl-NL"), "");
});

test("keeps a stored spelling language and otherwise follows the app locale", () => {
  assert.deepEqual(resolveSpellcheckSettings(
    { enabled: false, language: "en-GB" },
    available,
    "de-DE",
  ), { enabled: false, language: "en-GB" });
  assert.deepEqual(resolveSpellcheckSettings(null, available, "de-AT"), {
    enabled: true,
    language: "de-DE",
  });
});

test("puts common languages and the current language in the short menu", () => {
  const languages = commonSpellcheckLanguages(available, "uk");
  assert.equal(languages[0], "uk");
  assert.ok(languages.includes("de-DE"));
  assert.ok(languages.includes("en-US"));
  assert.equal(new Set(languages).size, languages.length);
});
