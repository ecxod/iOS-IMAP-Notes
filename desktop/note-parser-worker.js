"use strict";

const { parentPort } = require("node:worker_threads");
const { parseAppleNoteSource } = require("./apple-note");

parentPort.on("message", async message => {
  try {
    const note = await parseAppleNoteSource(
      Buffer.from(message.source),
      message.metadata,
    );
    parentPort.postMessage({ id: message.id, ok: true, note });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error?.message || String(error),
    });
  }
});
