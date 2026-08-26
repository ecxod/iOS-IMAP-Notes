const assert = require("node:assert/strict");
const test = require("node:test");
const { updaterErrorMessage } = require("../update-utils");

test("replaces a missing latest.yml stack trace with a useful message", () => {
  const error = new Error(
    'Cannot find latest.yml in the latest release artifacts: HttpError: 404\n'
      + "at createHttpError (C:\\app\\resources\\app.asar\\httpExecutor.js:53:12)",
  );
  assert.equal(
    updaterErrorMessage(error),
    "The latest GitHub release does not provide update information yet.",
  );
});

test("shows only a bounded first line for other update errors", () => {
  const message = `Network unavailable${"x".repeat(300)}\nprivate stack trace`;
  assert.equal(updaterErrorMessage(new Error(message)).length, 240);
  assert.doesNotMatch(updaterErrorMessage(new Error(message)), /stack trace/);
});
