const { createHash, randomUUID } = require("node:crypto");
const { simpleParser } = require("mailparser");
const MailComposer = require("nodemailer/lib/mail-composer");

const APPLE_NOTE_UTI = "com.apple.mail-note";
const MAX_NOTE_LENGTH = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TITLE_LENGTH = 500;
const IMAGE_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const APPLE_OBJECT_PATTERN = /<object\b[^>]*\bdata\s*=\s*(["'])cid:([^"']+)\1[^>]*>(?:[\s\S]*?<\/object\s*>)?/gi;
const APPLE_CID_IMAGE_PATTERN = /<img\b[^>]*\bsrc\s*=\s*(["'])cid:([^"']+)\1[^>]*>/gi;

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

function cleanHeaderValue(value, maximum = 1000) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, maximum);
}

function conversationHeaders(value) {
  if (!value || !["chatgpt", "gemini"].includes(value.provider) || !value.id) {
    return {};
  }
  return {
    "X-iOS-IMAP-Notes-Conversation-ID": cleanHeaderValue(value.id, 100),
    "X-iOS-IMAP-Notes-Provider": value.provider,
    "X-iOS-IMAP-Notes-Share-IDs": (Array.isArray(value.shareIds) ? value.shareIds : [])
      .map(item => cleanHeaderValue(item, 100))
      .filter(Boolean)
      .slice(-50)
      .join(","),
    "X-iOS-IMAP-Notes-Source-Revision": cleanHeaderValue(value.latestSourceRevision, 100),
  };
}

function parsedConversation(mail) {
  const id = headerText(mail, "x-ios-imap-notes-conversation-id").trim();
  const provider = headerText(mail, "x-ios-imap-notes-provider").trim().toLowerCase();
  if (!id || !["chatgpt", "gemini"].includes(provider)) {
    return null;
  }
  return {
    id,
    provider,
    shareIds: headerText(mail, "x-ios-imap-notes-share-ids")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
      .slice(-50),
    latestShareUrl: "",
    latestSourceRevision: headerText(mail, "x-ios-imap-notes-source-revision").trim(),
  };
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

function cleanContentId(value) {
  const contentId = String(value || "").trim().replace(/^<|>$/g, "");
  return contentId && !/[<>\s\r\n]/.test(contentId) ? contentId : "";
}

function cidContentId(value) {
  const raw = String(value || "").replace(/^cid:/i, "");
  try {
    return cleanContentId(decodeURIComponent(raw));
  } catch {
    return cleanContentId(raw);
  }
}

function referencedContentIds(bodyHtml) {
  const result = new Set();
  for (const match of String(bodyHtml || "").matchAll(APPLE_OBJECT_PATTERN)) {
    const contentId = cidContentId(match[2]);
    if (contentId) {
      result.add(contentId.toLowerCase());
    }
  }
  for (const match of String(bodyHtml || "").matchAll(APPLE_CID_IMAGE_PATTERN)) {
    const contentId = cidContentId(match[2]);
    if (contentId) {
      result.add(contentId.toLowerCase());
    }
  }
  return result;
}

function normalizeImage(value, index = 0) {
  const contentId = cleanContentId(value?.contentId);
  const contentType = String(value?.contentType || "").toLowerCase();
  const normalizedType = contentType === "image/jpg" ? "image/jpeg" : contentType;
  const filename = String(value?.filename || `image-${index + 1}`).replace(/[\r\n"\\]/g, "_").slice(0, 240);
  const dataBase64 = String(value?.dataBase64 || "").replace(/\s+/g, "");
  let bytes;
  try {
    bytes = Buffer.from(dataBase64, "base64");
  } catch {
    bytes = Buffer.alloc(0);
  }
  if (!contentId || !IMAGE_CONTENT_TYPES.has(contentType) || !dataBase64 || !bytes.length) {
    throw new TypeError("Invalid inline image metadata.");
  }
  if (bytes.toString("base64").replace(/=+$/, "") !== dataBase64.replace(/=+$/, "")) {
    throw new TypeError("Invalid inline image data.");
  }
  return { contentId, contentType: normalizedType, filename, dataBase64, bytes };
}

function normalizeImages(values) {
  const images = (Array.isArray(values) ? values : []).map(normalizeImage);
  const ids = new Set();
  let totalBytes = 0;
  for (const image of images) {
    const key = image.contentId.toLowerCase();
    if (ids.has(key)) {
      throw new TypeError(`Duplicate inline image Content-ID: ${image.contentId}`);
    }
    ids.add(key);
    totalBytes += image.bytes.length;
  }
  if (totalBytes > MAX_IMAGE_BYTES) {
    throw new TypeError("Inline images may use at most 6 MB in total.");
  }
  return images;
}

function validateImageReferences(bodyHtml, images) {
  const references = referencedContentIds(bodyHtml);
  const imageIds = new Set(images.map(image => image.contentId.toLowerCase()));
  if (references.size !== imageIds.size
      || [...references].some(contentId => !imageIds.has(contentId))) {
    throw new TypeError("The note body and inline image Content-IDs do not match.");
  }
}

function renderAppleImages(bodyHtml, rawImages) {
  const images = new Map(normalizeImages(rawImages).map(image => [image.contentId.toLowerCase(), image]));
  const imageAttributes = image => {
    const filename = image.filename.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return [
      `src="data:${image.contentType};base64,${image.dataBase64}"`,
      `alt="${filename}"`,
      `data-apple-content-id="${image.contentId}"`,
      `data-apple-content-type="${image.contentType}"`,
      `data-apple-filename="${filename}"`,
    ].join(" ");
  };
  const objectsRendered = String(bodyHtml || "").replace(APPLE_OBJECT_PATTERN, (object, _quote, rawContentId) => {
    const image = images.get(cidContentId(rawContentId).toLowerCase());
    if (!image) {
      return object;
    }
    return `<img ${imageAttributes(image)}>`;
  });
  return objectsRendered.replace(APPLE_CID_IMAGE_PATTERN, (tag, _quote, rawContentId) => {
    const image = images.get(cidContentId(rawContentId).toLowerCase());
    if (!image) {
      return tag;
    }
    return `<img ${imageAttributes(image)}>`;
  });
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
  const references = referencedContentIds(bodyHtml);
  const images = [];
  let unsupportedAttachment = false;
  let imageBytes = 0;
  for (const [index, attachment] of mail.attachments.entries()) {
    const typeParameters = attachment.headers?.get("content-type")?.params || {};
    const contentId = cidContentId(
      attachment.contentId || attachment.cid || typeParameters["x-apple-part-url"],
    );
    const contentType = String(attachment.contentType || "").toLowerCase();
    const referenced = contentId && references.has(contentId.toLowerCase());
    if (!IMAGE_CONTENT_TYPES.has(contentType) || !referenced) {
      unsupportedAttachment = true;
      continue;
    }
    imageBytes += attachment.content.length;
    if (imageBytes > MAX_IMAGE_BYTES) {
      unsupportedAttachment = true;
      continue;
    }
    images.push(normalizeImage({
      contentId,
      contentType,
      filename: attachment.filename || `image-${index + 1}`,
      dataBase64: attachment.content.toString("base64"),
    }, index));
  }
  const imageIds = new Set(images.map(image => image.contentId.toLowerCase()));
  if (imageIds.size !== images.length) {
    unsupportedAttachment = true;
  }
  if ([...references].some(contentId => !imageIds.has(contentId))) {
    unsupportedAttachment = true;
  }
  const readOnly = unsupportedAttachment;
  return {
    id: noteId(metadata.accountId, metadata.mailbox, uuid, uidValidity, uid),
    title,
    bodyHtml,
    searchText: `${title} ${mail.text || htmlToSearchText(bodyHtml)}`.toLocaleLowerCase(),
    updatedAt: (metadata.internalDate || mail.date || new Date()).getTime(),
    images: images.map(({ bytes: _bytes, ...image }) => image),
    readOnly,
    unsupportedReason: readOnly
      ? "This note contains a non-image, malformed or oversized attachment and is read-only to prevent data loss."
      : "",
    conversation: parsedConversation(mail),
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
  const bodyHtml = String(input.bodyHtml || "<div><br></div>").slice(0, MAX_NOTE_LENGTH);
  const images = normalizeImages(input.images);
  validateImageReferences(bodyHtml, images);
  const composer = new MailComposer({
    from,
    subject: cleanTitle(input.title),
    date: now,
    messageId,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`,
    attachments: images.map(image => ({
      filename: image.filename,
      content: image.bytes,
      contentType: `${image.contentType}; x-apple-part-url="${image.contentId}"`,
      contentDisposition: "inline",
      cid: image.contentId,
    })),
    headers: {
      "X-Mail-Created-Date": input.createdDate || now.toUTCString(),
      "X-Uniform-Type-Identifier": APPLE_NOTE_UTI,
      "X-Universally-Unique-Identifier": uuid,
      ...conversationHeaders(input.conversation),
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
  MAX_IMAGE_BYTES,
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  buildAppleNoteSource,
  cleanTitle,
  extractBody,
  htmlToSearchText,
  noteId,
  parseAppleNoteSource,
  renderAppleImages,
  sourceRevision,
};
