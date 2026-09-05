function destinationAccounts(accounts, source) {
  const sourceAccountId = source?.home?.kind === "imap" ? source.home.accountId : "";
  return (Array.isArray(accounts) ? accounts : []).filter(account => (
    account
      && account.enabled !== false
      && typeof account.id === "string"
      && account.id
      && account.id !== sourceAccountId
  ));
}

function transferContent(source, draft) {
  if (!source || typeof source !== "object") {
    throw new Error("The source note no longer exists.");
  }
  if (source.readOnly) {
    throw new Error("This read-only note cannot be copied without losing unsupported attachments.");
  }
  if (draft?.id && draft.id !== source.id) {
    throw new Error("The transfer content does not belong to the selected note.");
  }
  return {
    title: String(draft?.title ?? source.title ?? ""),
    bodyHtml: String(draft?.bodyHtml ?? source.bodyHtml ?? ""),
    images: Array.isArray(draft?.images) ? draft.images : (source.images || []),
    conversation: source.conversation,
  };
}

async function transferNoteSafely({
  mode,
  source,
  draft,
  createDestination,
  persistState,
  deleteSource,
}) {
  if (!["copy", "move"].includes(mode)) {
    throw new Error("Choose Copy or Move.");
  }
  const content = transferContent(source, draft);
  const copied = await createDestination(content);

  // Keep both cached until source deletion succeeds. A failed move therefore
  // becomes a safe copy instead of losing either version of the note.
  await persistState({ copied, sourceRemoved: false });
  if (mode === "copy") {
    return { note: copied, sourceRemoved: false, warning: "" };
  }

  try {
    await deleteSource();
  } catch (error) {
    return {
      note: copied,
      sourceRemoved: false,
      warning: `The note was copied to the destination, but could not be removed from its source: ${error.message}`,
    };
  }
  await persistState({ copied, sourceRemoved: true });
  return { note: copied, sourceRemoved: true, warning: "" };
}

module.exports = {
  destinationAccounts,
  transferContent,
  transferNoteSafely,
};
