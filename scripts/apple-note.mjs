export const APPLE_NOTE_UTI = "com.apple.mail-note";

function firstHeader(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function findPart(parts, contentType) {
  for (const part of parts || []) {
    if (part.contentType?.toLowerCase().startsWith(contentType)) {
      return part;
    }
    const nested = findPart(part.parts, contentType);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function isAppleNote(fullMessage) {
  return (fullMessage?.headers?.["x-uniform-type-identifier"] || [])
    .some(value => value.toLowerCase() === APPLE_NOTE_UTI);
}

export function parseAppleNote(fullMessage) {
  if (!isAppleNote(fullMessage)) {
    return null;
  }

  const htmlPart = findPart(fullMessage.parts, "text/html");
  const textPart = findPart(fullMessage.parts, "text/plain");
  const source = htmlPart?.body ?? textPart?.body;
  if (typeof source !== "string") {
    return null;
  }

  const bodyMatch = source.match(/^([\s\S]*?<body\b[^>]*>)([\s\S]*)(<\/body>[\s\S]*)$/i);
  const subject = firstHeader(fullMessage.headers, "subject") || "";

  if (bodyMatch) {
    return {
      subject,
      bodyHtml: bodyMatch[2],
      htmlPrefix: bodyMatch[1],
      htmlSuffix: bodyMatch[3],
    };
  }

  return {
    subject,
    bodyHtml: source,
    htmlPrefix: "",
    htmlSuffix: "",
  };
}

export function replaceAppleNoteBody(parsedNote, bodyHtml) {
  return `${parsedNote.htmlPrefix}${bodyHtml}${parsedNote.htmlSuffix}`;
}

export function createAppleNoteDocument(subject) {
  const escapedSubject = subject
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head><meta charset=\"utf-8\"></head>",
    "<body style=\"word-wrap: break-word; -webkit-nbsp-mode: space; -webkit-line-break: after-white-space;\">",
    escapedSubject,
    "<div><br></div>",
    "</body>",
    "</html>",
  ].join("");
}
