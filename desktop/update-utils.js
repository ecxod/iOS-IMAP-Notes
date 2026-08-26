const MAX_UPDATE_ERROR_LENGTH = 240;

function updaterErrorMessage(error) {
  const message = error?.message || String(error || "Unknown update error");
  if (/cannot find latest\.yml|latest\.yml.*(?:404|not found)/i.test(message)) {
    return "The latest GitHub release does not provide update information yet.";
  }
  return message.split(/\r?\n/, 1)[0].slice(0, MAX_UPDATE_ERROR_LENGTH);
}

module.exports = { updaterErrorMessage };
