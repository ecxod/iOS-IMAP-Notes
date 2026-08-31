"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");
const { buildAppleNoteSource } = require("../apple-note");

function parseInWorker(source, metadata) {
  const worker = new Worker(path.join(__dirname, "..", "note-parser-worker.js"));
  return new Promise((resolve, reject) => {
    worker.once("message", message => {
      worker.terminate();
      if (message.ok) {
        resolve(message.note);
      } else {
        reject(new Error(message.error));
      }
    });
    worker.once("error", reject);
    worker.postMessage({ id: 1, source, metadata });
  });
}

test("parses image notes outside the Electron main thread", async () => {
  const contentId = "WORKER-IMAGE@mobilenotes.apple.com";
  const dataBase64 = Buffer.from("worker image").toString("base64");
  const built = await buildAppleNoteSource({
    title: "Worker image",
    bodyHtml: `<div><object type="application/x-apple-msg-attachment" data="cid:${contentId}"></object></div>`,
    images: [{ contentId, contentType: "image/jpeg", filename: "worker.jpg", dataBase64 }],
  });
  const note = await parseInWorker(built.source, {
    accountId: "account",
    mailbox: "Notes",
    uid: 7,
    uidValidity: 11,
    internalDate: new Date(),
  });

  assert.equal(note.readOnly, false);
  assert.equal(note.images.length, 1);
  assert.equal(note.images[0].contentId, contentId);
  assert.equal(note.images[0].dataBase64, dataBase64);
});
