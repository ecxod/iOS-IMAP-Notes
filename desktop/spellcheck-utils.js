"use strict";

const COMMON_LANGUAGE_CODES = Object.freeze([
  "de-DE",
  "de-CH",
  "de-AT",
  "en-US",
  "en-GB",
  "es-ES",
  "fr-FR",
  "it-IT",
]);

function matchingLanguage(availableLanguages, requestedLanguage) {
  const requested = String(requestedLanguage || "").replaceAll("_", "-").toLowerCase();
  if (!requested) {
    return "";
  }
  const exact = availableLanguages.find(code => code.toLowerCase() === requested);
  if (exact) {
    return exact;
  }
  const base = requested.split("-")[0];
  return availableLanguages.find(code => code.toLowerCase() === base)
    || availableLanguages.find(code => code.toLowerCase().startsWith(`${base}-`))
    || "";
}

function resolveSpellcheckSettings(value, availableLanguages, locale) {
  const available = [...new Set((availableLanguages || []).map(String).filter(Boolean))];
  const language = matchingLanguage(available, value?.language)
    || matchingLanguage(available, locale)
    || matchingLanguage(available, "en-US")
    || available[0]
    || "";
  return {
    enabled: value?.enabled !== false,
    language,
  };
}

function commonSpellcheckLanguages(availableLanguages, currentLanguage = "") {
  const available = [...new Set((availableLanguages || []).map(String).filter(Boolean))];
  const common = COMMON_LANGUAGE_CODES
    .map(code => matchingLanguage(available, code))
    .filter((code, index, values) => code && values.indexOf(code) === index);
  const current = matchingLanguage(available, currentLanguage);
  if (current && !common.includes(current)) {
    common.unshift(current);
  }
  return common;
}

module.exports = {
  commonSpellcheckLanguages,
  matchingLanguage,
  resolveSpellcheckSettings,
};
