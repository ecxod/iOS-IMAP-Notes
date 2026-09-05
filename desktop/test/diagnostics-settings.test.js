const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeSentryDsn } = require("../diagnostics-settings");

test("accepts hosted and self-hosted Sentry DSNs", () => {
  assert.equal(
    normalizeSentryDsn(" https://public-key@sentry.example/42 "),
    "https://public-key@sentry.example/42",
  );
  assert.equal(normalizeSentryDsn(""), "");
});

test("rejects ordinary and incomplete URLs as Sentry DSNs", () => {
  assert.throws(() => normalizeSentryDsn("https://sentry.example/42"), /valid Sentry DSN/);
  assert.throws(() => normalizeSentryDsn("file:///tmp/sentry"), /valid Sentry DSN/);
  assert.throws(() => normalizeSentryDsn("not a URL"), /valid Sentry DSN/);
});
