(function exposeNoteTabs(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NoteTabs = api;
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  function scopeForNote(note) {
    return note?.home?.kind === "imap" ? String(note.home.accountId || "") : "local";
  }

  function noteTarget(tabs, activeId, note) {
    const existing = tabs.find(tab => tab.noteId === note.id);
    if (existing) {
      return { action: "activate", tabId: existing.id };
    }
    const scope = scopeForNote(note);
    const active = tabs.find(tab => tab.id === activeId);
    if (active && !active.noteId && active.scope === scope) {
      return { action: "reuse", tabId: active.id };
    }
    return { action: "create", tabId: null };
  }

  function accountTarget(tabs, activeId, scope) {
    if (!scope || scope === "all") {
      return { action: "none", tabId: null };
    }
    const active = tabs.find(tab => tab.id === activeId);
    if (active?.scope === scope) {
      return { action: "none", tabId: active.id };
    }
    return { action: "create", tabId: null };
  }

  return { accountTarget, noteTarget, scopeForNote };
});
