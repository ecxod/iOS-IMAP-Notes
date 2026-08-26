export const APPLE_NOTE_UTI = "com.apple.mail-note";

function firstHeader(headers, name) {
  return headerValues(headers, name)[0];
}

function headerValues(headers, name) {
  const wantedName = name.toLowerCase();
  const entry = Object.entries(headers || {})
    .find(([headerName]) => headerName.toLowerCase() === wantedName);
  if (!entry) {
    return [];
  }
  return Array.isArray(entry[1]) ? entry[1] : [entry[1]];
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
  return headerValues(fullMessage?.headers, "x-uniform-type-identifier")
    .some(value => String(value).trim().toLowerCase() === APPLE_NOTE_UTI);
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

export async function waitForAppleNote(
  loadMessage,
  { attempts = 1, delayMs = 250 } = {},
) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const full = await loadMessage();
      const parsed = parseAppleNote(full);
      if (parsed) {
        return { full, parsed };
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    if (attempt + 1 < attempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
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
