// The addons.thunderbird.net edition uses only built-in MailExtension APIs.
// The GitHub Header Controls edition replaces this module while packaging.

export async function setNoteHeaderMode() {
  return false;
}

export function addNewNoteHeaderListener() {
  // Native message-header controls are unavailable without an Experiment API.
}

export async function refreshNoteFolder() {
  return false;
}
