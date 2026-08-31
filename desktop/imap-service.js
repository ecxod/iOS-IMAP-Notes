const { ImapFlow } = require("imapflow");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const {
  APPLE_NOTE_UTI,
  buildAppleNoteSource,
  sourceRevision,
} = require("./apple-note");

const CONNECTION_TIMEOUT = 20_000;
let parserWorker = null;
let parserRequestId = 0;
const parserRequests = new Map();

function rejectParserRequests(error) {
  for (const request of parserRequests.values()) {
    request.reject(error);
  }
  parserRequests.clear();
}

function getParserWorker() {
  if (parserWorker) {
    return parserWorker;
  }
  const worker = new Worker(path.join(__dirname, "note-parser-worker.js"));
  worker.unref();
  worker.on("message", message => {
    const request = parserRequests.get(message.id);
    if (!request) {
      return;
    }
    parserRequests.delete(message.id);
    if (message.ok) {
      request.resolve(message.note);
    } else {
      request.reject(new Error(message.error || "The note could not be parsed."));
    }
  });
  worker.on("error", error => {
    if (parserWorker === worker) {
      parserWorker = null;
    }
    rejectParserRequests(error);
  });
  worker.on("exit", code => {
    const wasCurrent = parserWorker === worker;
    if (wasCurrent) {
      parserWorker = null;
    }
    if (wasCurrent && code !== 0) {
      rejectParserRequests(new Error(`The note parser stopped unexpectedly (${code}).`));
    }
  });
  parserWorker = worker;
  return worker;
}

function parseAppleNoteSource(source, metadata) {
  const id = ++parserRequestId;
  return new Promise((resolve, reject) => {
    parserRequests.set(id, { resolve, reject });
    try {
      getParserWorker().postMessage({ id, source: Buffer.from(source), metadata });
    } catch (error) {
      parserRequests.delete(id);
      reject(error);
    }
  });
}

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

async function syncAccount(account, password, cachedNotes = []) {
  return withClient(account, password, async client => {
    const lock = await client.getMailboxLock(account.mailbox, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      const uids = await client.search({
        header: { "x-uniform-type-identifier": APPLE_NOTE_UTI },
      }, { uid: true }) || [];
      if (!uids.length) {
        return { notes: [], changed: cachedNotes.length > 0 };
      }
      const uidSet = new Set(uids.map(uid => String(uid)));
      const reusable = cachedNotes.filter(note =>
        String(note.home?.uidValidity) === uidValidity
          && uidSet.has(String(note.home?.uid))
      );
      const reusableUids = new Set(reusable.map(note => String(note.home.uid)));
      const missingUids = uids.filter(uid => !reusableUids.has(String(uid)));
      if (!missingUids.length) {
        return {
          notes: reusable,
          changed: reusable.length !== cachedNotes.length,
        };
      }
      const messages = await client.fetchAll(
        missingUids,
        { source: true, internalDate: true, uid: true },
        { uid: true },
      );
      const notes = [...reusable];
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
      return { notes, changed: true };
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
        images: input.images,
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
        images: note.images,
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
