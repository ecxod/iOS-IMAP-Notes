"use strict";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function replaceContentId(bodyHtml, previous, replacement) {
  const escaped = String(previous || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(bodyHtml || "").replace(
    new RegExp(`cid:${escaped}`, "gi"),
    `cid:${replacement}`,
  );
}

function versionSignature(note) {
  return JSON.stringify({
    bodyHtml: String(note.bodyHtml || "").replace(/\s+/g, " ").trim(),
    images: (Array.isArray(note.images) ? note.images : []).map(image => ({
      contentType: image.contentType,
      dataBase64: image.dataBase64,
    })),
  });
}

function versionLabel(note) {
  const updatedAt = Number(note.updatedAt);
  const date = Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : "unknown date";
  return `${String(note.title || "Untitled note")} — ${date}`;
}

function mergeNoteVersions(notes, targetId, createContentId) {
  const versions = Array.isArray(notes) ? notes : [];
  const target = versions.find(note => note.id === targetId);
  if (!target || versions.length < 2) {
    throw new Error("Select at least two notes and choose the merge target.");
  }
  const ordered = [
    target,
    ...versions.filter(note => note.id !== targetId)
      .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0)),
  ];
  const knownImages = new Map();
  const mergedImages = [];
  const signatures = new Set();
  const bodyParts = [];
  let skippedDuplicates = 0;

  for (const [index, note] of ordered.entries()) {
    const signature = versionSignature(note);
    if (signatures.has(signature)) {
      skippedDuplicates += 1;
      continue;
    }
    signatures.add(signature);
    let bodyHtml = String(note.bodyHtml || "");
    for (const image of Array.isArray(note.images) ? note.images : []) {
      const previous = knownImages.get(String(image.contentId || "").toLowerCase());
      if (!previous) {
        knownImages.set(String(image.contentId || "").toLowerCase(), image);
        mergedImages.push(image);
        continue;
      }
      if (previous.contentType === image.contentType && previous.dataBase64 === image.dataBase64) {
        continue;
      }
      const replacement = `${createContentId()}@merged.notes`;
      bodyHtml = replaceContentId(bodyHtml, image.contentId, replacement);
      const remapped = { ...image, contentId: replacement };
      knownImages.set(replacement.toLowerCase(), remapped);
      mergedImages.push(remapped);
    }
    if (index === 0) {
      bodyParts.push(bodyHtml);
    } else {
      bodyParts.push(
        "<hr>",
        `<h2>Merged version: ${escapeHtml(versionLabel(note))}</h2>`,
        bodyHtml,
      );
    }
  }
  return {
    title: target.title,
    bodyHtml: bodyParts.join(""),
    images: mergedImages,
    includedVersions: signatures.size,
    skippedDuplicates,
  };
}

module.exports = { mergeNoteVersions };
