export function setNoteHeaderMode(tabId, enabled, newNoteLabel) {
  return browser.notesHeader.setNoteMode(tabId, enabled, newNoteLabel);
}

export function addNewNoteHeaderListener(listener) {
  browser.notesHeader.onNewNote.addListener(listener);
}
