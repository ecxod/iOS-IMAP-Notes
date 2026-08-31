#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createAppleAttachmentObject,
  createRawAppleNoteMessage,
} from "./rfc822.mjs";

const MIME_TYPES = new Map([
  [".aac", "audio/aac"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".wav", "audio/wav"],
  [".webp", "image/webp"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/create-attachment-note.mjs [options] FILE ...",
    "",
    "Options:",
    "  --title TEXT       Note title (default: Anhangstest)",
    "  --body TEXT        Text before the attachments",
    "  --from ADDRESS     From address (default: notes@localhost)",
    "  --output FILE      Output .eml file (default: apple-attachment-test.eml)",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseArguments(values) {
  const options = {
    title: "Anhangstest",
    body: "Apple-kompatible IMAP-Notiz mit Anhang",
    from: "notes@localhost",
    output: "apple-attachment-test.eml",
    files: [],
  };
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (["--title", "--body", "--from", "--output"].includes(value)) {
      if (index + 1 >= values.length) {
        throw new Error(`${value} requires a value`);
      }
      options[value.slice(2)] = values[++index];
    } else if (value === "--help" || value === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      options.files.push(value);
    }
  }
  if (!options.files.length) {
    throw new Error("At least one attachment file is required");
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const uuid = randomUUID().toUpperCase();
const now = new Date().toUTCString();
const domain = options.from.match(/@([^>\s]+)>?$/)?.[1] || "localhost";
const attachments = await Promise.all(options.files.map(async filename => {
  const contentId = `${randomUUID().toUpperCase()}@mobilenotes.apple.com`;
  return {
    filename: path.basename(filename),
    contentType: MIME_TYPES.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
    contentId,
    data: new Uint8Array(await readFile(filename)),
  };
}));
const attachmentObjects = attachments
  .map(attachment => `<div>${createAppleAttachmentObject(attachment.contentId)}</div>`)
  .join("");
const html = [
  "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head>",
  "<body style=\"overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;\">",
  `<div><b>${escapeHtml(options.title)}</b></div><div><br></div>`,
  `<div>${escapeHtml(options.body)}</div>`,
  attachmentObjects,
  "</body></html>",
].join("");
const raw = createRawAppleNoteMessage({
  from: [options.from],
  subject: [options.title],
  date: [now],
  "x-mail-created-date": [now],
  "x-uniform-type-identifier": ["com.apple.mail-note"],
  "x-universally-unique-identifier": [uuid],
  "message-id": [`<${uuid}@${domain}>`],
}, html, attachments);

await writeFile(options.output, raw, "utf8");
console.log(`Created ${options.output} with ${attachments.length} attachment(s).`);
