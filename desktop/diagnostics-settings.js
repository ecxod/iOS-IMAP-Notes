function normalizeSentryDsn(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid Sentry DSN URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)
      || !url.hostname
      || !url.username
      || !url.pathname.split("/").filter(Boolean).length) {
    throw new Error("Enter a valid Sentry DSN URL.");
  }
  url.hash = "";
  url.search = "";
  return url.href;
}

module.exports = { normalizeSentryDsn };
