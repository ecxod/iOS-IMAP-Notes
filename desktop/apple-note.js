const { createHash, randomUUID } = require("node:crypto");
const { simpleParser } = require("mailparser");
const MailComposer = require("nodemailer/lib/mail-composer");

const APPLE_NOTE_UTI = "com.apple.mail-note";
const MAX_NOTE_LENGTH = 10 * 1024 * 1024;
const MAX_TITLE_LENGTH = 500;

function cleanTitle(value, fallback = "New note") {
  const title = String(value || "").trim().slice(0, MAX_TITLE_LENGTH);
  return title || fallback;
}

function headerText(mail, name) {
  const value = mail.headers.get(name.toLowerCase());
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toUTCString();
  }
  if (typeof value === "object" && typeof value.text === "string") {
    return value.text;
  }
  return String(value);
}

function extractBody(html) {
  const source = String(html || "").slice(0, MAX_NOTE_LENGTH);
  const match = source.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return match ? match[1] : source;
}

function htmlToSearchText(html) {
  return String(html || "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}

function noteId(accountId, mailbox, uuid, uidValidity, uid) {
  const stablePart = uuid || `${uidValidity}:${uid}`;
  return `imap:${accountId}:${encodeURIComponent(mailbox)}:${stablePart}`;
}

async function parseAppleNoteSource(source, metadata) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const mail = await simpleParser(buffer, {
    skipHtmlToText: false,
    skipImageLinks: true,
    maxHtmlLengthToParse: MAX_NOTE_LENGTH,
  });
  if (headerText(mail, "x-uniform-type-identifier").trim().toLowerCase() !== APPLE_NOTE_UTI) {
    return null;
  }

  const bodyHtml = extractBody(mail.html || mail.textAsHtml || "<div><br></div>");
  const uuid = headerText(mail, "x-universally-unique-identifier").trim().toUpperCase();
  const uid = String(metadata.uid);
  const uidValidity = String(metadata.uidValidity);
  const title = cleanTitle(mail.subject);
  return {
    id: noteId(metadata.accountId, metadata.mailbox, uuid, uidValidity, uid),
    title,
    bodyHtml,
    searchText: `${title} ${mail.text || htmlToSearchText(bodyHtml)}`.toLocaleLowerCase(),
    updatedAt: (metadata.internalDate || mail.date || new Date()).getTime(),
    home: {
      kind: "imap",
      accountId: metadata.accountId,
      mailbox: metadata.mailbox,
      uid,
      uidValidity,
      messageId: mail.messageId || "",
      uuid,
      revision: sourceRevision(buffer),
      createdDate: headerText(mail, "x-mail-created-date") || new Date().toUTCString(),
      from: mail.from?.text || metadata.from || "notes@localhost",
    },
  };
}

function messageDomain(address) {
  return String(address).match(/@([^>\s]+)>?$/)?.[1] || "localhost";
}

async function buildAppleNoteSource(input) {
  const now = new Date();
  const rawUuid = input.uuid || randomUUID();
  const uuid = rawUuid.toUpperCase();
  const from = input.from || "notes@localhost";
  const messageId = `<${randomUUID()}@${messageDomain(from)}>`;
  const composer = new MailComposer({
    from,
    subject: cleanTitle(input.title),
    date: now,
    messageId,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${String(input.bodyHtml || "<div><br></div>").slice(0, MAX_NOTE_LENGTH)}</body></html>`,
    headers: {
      "X-Mail-Created-Date": input.createdDate || now.toUTCString(),
      "X-Uniform-Type-Identifier": APPLE_NOTE_UTI,
      "X-Universally-Unique-Identifier": uuid,
    },
    newline: "windows",
  });
  return {
    source: await composer.compile().build(),
    uuid,
    messageId,
    date: now,
  };
}

module.exports = {
  APPLE_NOTE_UTI,
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  buildAppleNoteSource,
  cleanTitle,
  extractBody,
  htmlToSearchText,
  noteId,
  parseAppleNoteSource,
  sourceRevision,
};
