const SKIPPED_HEADERS = new Set([
  "content-transfer-encoding",
  "content-type",
  "mime-version",
  "x-mozilla-keys",
  "x-mozilla-status",
  "x-mozilla-status2",
]);

const HEADER_NAMES = new Map([
  ["date", "Date"],
  ["from", "From"],
  ["message-id", "Message-ID"],
  ["subject", "Subject"],
  ["x-mail-created-date", "X-Mail-Created-Date"],
  ["x-uniform-type-identifier", "X-Uniform-Type-Identifier"],
  ["x-universally-unique-identifier", "X-Universally-Unique-Identifier"],
]);

function cleanHeaderValue(value) {
  return String(value)
    .replace(/\r?\n[ \t]*/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function encodeWordChunks(value) {
  const chunks = [];
  let chunk = "";
  let chunkBytes = 0;

  for (const character of value) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (chunk && chunkBytes + characterBytes > 45) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) {
    chunks.push(chunk);
  }

  return chunks.map(chunk => {
    const encoded = bytesToBase64(new TextEncoder().encode(chunk));
    return `=?UTF-8?B?${encoded}?=`;
  }).join("\r\n ");
}

function encodeMailbox(value) {
  const cleaned = cleanHeaderValue(value);
  const match = cleaned.match(/^(.*?)\s*<([^<>\s]+)>$/);
  if (!match) {
    return cleaned;
  }
  const name = match[1].replace(/^["']|["']$/g, "").trim();
  return name ? `${encodeWordChunks(name)} <${match[2]}>` : `<${match[2]}>`;
}

function firstHeaderValue(values) {
  return Array.isArray(values) ? values[0] : values;
}

export function createRawAppleNoteMessage(headers, html) {
  const lines = [];

  for (const [originalName, values] of Object.entries(headers || {})) {
    const name = originalName.toLowerCase();
    if (SKIPPED_HEADERS.has(name)) {
      continue;
    }
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(originalName)) {
      throw new TypeError(`Invalid message header name: ${originalName}`);
    }

    const rawValue = firstHeaderValue(values);
    if (rawValue == null || (rawValue === "" && name !== "subject")) {
      continue;
    }
    const value = name === "subject"
      ? encodeWordChunks(cleanHeaderValue(rawValue))
      : name === "from"
        ? encodeMailbox(rawValue)
        : cleanHeaderValue(rawValue);
    lines.push(`${HEADER_NAMES.get(name) || originalName}: ${value}`);
  }

  if (!lines.some(line => line.toLowerCase().startsWith("from:"))) {
    throw new TypeError("The From header is required");
  }
  if (!lines.some(line => line.toLowerCase().startsWith("subject:"))) {
    throw new TypeError("The Subject header is required");
  }

  lines.push(
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(html),
  );
  return lines.join("\r\n");
}
