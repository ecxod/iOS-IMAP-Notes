(function initImageResize(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NoteImages = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function normalizedSize(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function hasExplicitResize(originSize, currentSize) {
    const origin = normalizedSize(originSize);
    const current = normalizedSize(currentSize);
    return Boolean(origin && current && origin !== current);
  }

  function downscaleTarget(input) {
    if (!hasExplicitResize(input?.originSize, input?.currentSize)) {
      return null;
    }
    const naturalWidth = Number(input.naturalWidth);
    const naturalHeight = Number(input.naturalHeight);
    const displayWidth = Number(input.displayWidth);
    const displayHeight = Number(input.displayHeight);
    if (![naturalWidth, naturalHeight, displayWidth, displayHeight]
      .every(value => Number.isFinite(value) && value > 0)) {
      return null;
    }
    const scale = Math.min(1, displayWidth / naturalWidth, displayHeight / naturalHeight);
    if (scale >= 0.995) {
      return null;
    }
    return {
      width: Math.max(1, Math.round(naturalWidth * scale)),
      height: Math.max(1, Math.round(naturalHeight * scale)),
      scale,
    };
  }

  return Object.freeze({ downscaleTarget, hasExplicitResize });
});
