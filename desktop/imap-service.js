const { ImapFlow } = require("imapflow");
const {
  APPLE_NOTE_UTI,
  buildAppleNoteSource,
  parseAppleNoteSource,
  sourceRevision,
} = require("./apple-note");

const CONNECTION_TIMEOUT = 20_000;

function createClient(account, password) {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass: password },
    logger: false,
    connectionTimeout: CONNECTION_TIMEOUT,
    greetingTimeout: CONNECTION_TIMEOUT,
    socketTimeout: 60_000,
    tls: { rejectUnauthorized: account.allowInvalidCertificates !== true },
  });
}

async function withClient(account, password, action) {
  const client = createClient(account, password);
  client.on("error", error => console.error(`IMAP error for ${account.name}`, error));
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function testAccount(account, password) {
  return withClient(account, password, async client => {
    const mailboxes = await client.list();
    return mailboxes
      .filter(item => !item.noSelect)
      .map(item => item.path)
      .sort((a, b) => a.localeCompare(b));
  });
}

async function syncAccount(account, password) {
  return withClient(account, password, async client => {
    const lock = await client.getMailboxLock(account.mailbox, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      const uids = await client.search({
        header: { "x-uniform-type-identifier": APPLE_NOTE_UTI },
      }, { uid: true }) || [];
      if (!uids.length) {
        return [];
      }
      const messages = await client.fetchAll(
        uids,
        { source: true, internalDate: true, uid: true },
        { uid: true },
      );
      const notes = [];
      for (const message of messages) {
        const note = await parseAppleNoteSource(message.source, {
          accountId: account.id,
          mailbox: account.mailbox,
          uid: message.uid,
          uidValidity,
          internalDate: message.internalDate,
          from: account.user,
        });
        if (note) {
          notes.push(note);
        }
      }
      return notes;
    } finally {
      lock.release();
    }
  });
}

async function resolveAppendedUid(client, appendResult, messageId) {
  if (appendResult?.uid) {
    return appendResult.uid;
  }
  const matches = await client.search({ header: { "message-id": messageId } }, { uid: true });
  return matches?.at(-1) || null;
}

function conflictError() {
  const error = new Error("This note changed on the IMAP server. Synchronize and open the current version before saving.");
  error.code = "NOTE_CONFLICT";
  return error;
}

async function verifyCurrentSource(client, note) {
  if (String(client.mailbox.uidValidity) !== String(note.home.uidValidity)) {
    throw conflictError();
  }
  const current = await client.fetchOne(
    Number(note.home.uid),
    { source: true, uid: true },
    { uid: true },
  );
  if (!current?.source || sourceRevision(current.source) !== note.home.revision) {
    throw conflictError();
  }
}

async function createImapNote(account, password, input) {
  return withClient(account, password, async client => {
    const lock = await client.getMailboxLock(account.mailbox);
    try {
      const built = await buildAppleNoteSource({
        title: input.title,
        bodyHtml: input.bodyHtml,
        from: account.user,
      });
      const appended = await client.append(account.mailbox, built.source, ["\\Seen"], built.date);
      const uid = await resolveAppendedUid(client, appended, built.messageId);
      if (!uid) {
        throw new Error("The note was uploaded, but its new IMAP UID could not be determined.");
      }
      return parseAppleNoteSource(built.source, {
        accountId: account.id,
        mailbox: account.mailbox,
        uid,
        uidValidity: appended?.uidValidity || client.mailbox.uidValidity,
        internalDate: built.date,
        from: account.user,
      });
    } finally {
      lock.release();
    }
  });
}

async function saveImapNote(account, password, note) {
  return withClient(account, password, async client => {
    const lock = await client.getMailboxLock(note.home.mailbox);
    try {
      await verifyCurrentSource(client, note);
      const built = await buildAppleNoteSource({
        title: note.title,
        bodyHtml: note.bodyHtml,
        from: note.home.from || account.user,
        createdDate: note.home.createdDate,
        uuid: note.home.uuid,
      });
      const appended = await client.append(note.home.mailbox, built.source, ["\\Seen"], built.date);
      const uid = await resolveAppendedUid(client, appended, built.messageId);
      if (!uid) {
        throw new Error("The changed note was uploaded, but its new IMAP UID could not be determined.");
      }

      let warning = "";
      try {
        await client.messageDelete(Number(note.home.uid), { uid: true });
      } catch (error) {
        warning = "The new note was saved, but the old IMAP copy could not be removed. Synchronize before editing again.";
        console.error(warning, error);
      }
      const saved = await parseAppleNoteSource(built.source, {
        accountId: account.id,
        mailbox: note.home.mailbox,
        uid,
        uidValidity: appended?.uidValidity || client.mailbox.uidValidity,
        internalDate: built.date,
        from: note.home.from || account.user,
      });
      saved.id = note.id;
      return { note: saved, warning };
    } finally {
      lock.release();
    }
  });
}

async function deleteImapNote(account, password, note) {
  return withClient(account, password, async client => {
    const lock = await client.getMailboxLock(note.home.mailbox);
    try {
      await verifyCurrentSource(client, note);
      await client.messageDelete(Number(note.home.uid), { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

module.exports = {
  createImapNote,
  deleteImapNote,
  saveImapNote,
  syncAccount,
  testAccount,
};
