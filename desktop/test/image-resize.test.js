const assert = require("node:assert/strict");
const test = require("node:test");
const { downscaleTarget, hasExplicitResize } = require("../image-resize");

test("recognizes only an explicit SunEditor size change", () => {
  assert.equal(hasExplicitResize("800px,600px", "800px,600px"), false);
  assert.equal(hasExplicitResize("800px,600px", "400px,300px"), true);
  assert.equal(hasExplicitResize("", "400px,300px"), false);
});

test("calculates a proportional pixel target for a real downscale", () => {
  assert.deepEqual(downscaleTarget({
    originSize: "800px,600px",
    currentSize: "400px,300px",
    naturalWidth: 800,
    naturalHeight: 600,
    displayWidth: 400,
    displayHeight: 300,
  }), { width: 400, height: 300, scale: 0.5 });
});

test("does not rewrite images merely constrained by the editor or enlarged by the user", () => {
  assert.equal(downscaleTarget({
    originSize: "800px,600px",
    currentSize: "800px,600px",
    naturalWidth: 1600,
    naturalHeight: 1200,
    displayWidth: 800,
    displayHeight: 600,
  }), null);
  assert.equal(downscaleTarget({
    originSize: "800px,600px",
    currentSize: "1200px,900px",
    naturalWidth: 800,
    naturalHeight: 600,
    displayWidth: 1200,
    displayHeight: 900,
  }), null);
});
