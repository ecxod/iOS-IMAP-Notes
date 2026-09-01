import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);
const backgroundUrl = new URL("../background.js", import.meta.url);
const standardHeaderControlsUrl = new URL(
  "../scripts/header-controls.mjs",
  import.meta.url,
);
const experimentClientUrl = new URL(
  "../experiments/notesHeader/client.mjs",
  import.meta.url,
);

test("the default manifest is the ATN edition without an Experiment", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const gecko = manifest.browser_specific_settings?.gecko;

  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.experiment_apis, undefined);
  assert.equal(manifest.theme_experiment, undefined);
  assert.equal(gecko?.strict_max_version, undefined);
});

test("the ATN runtime has no notesHeader API dependency", async () => {
  const [background, headerControls] = await Promise.all([
    readFile(backgroundUrl, "utf8"),
    readFile(standardHeaderControlsUrl, "utf8"),
  ]);

  assert.doesNotMatch(background, /browser\.notesHeader/);
  assert.doesNotMatch(headerControls, /browser\.notesHeader/);
});

test("the GitHub Header Controls adapter is kept in its separate variant", async () => {
  const experimentClient = await readFile(experimentClientUrl, "utf8");

  assert.match(experimentClient, /browser\.notesHeader\.setNoteMode/);
  assert.match(experimentClient, /browser\.notesHeader\.onNewNote/);
});
