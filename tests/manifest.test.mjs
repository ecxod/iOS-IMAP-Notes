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
const experimentManifestFragmentUrl = new URL(
  "../experiments/notesHeader/manifest-fragment.json",
  import.meta.url,
);
const headerControlsUpdatesUrl = new URL(
  "../updates/header-controls.json",
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
  assert.equal(gecko?.update_url, undefined);
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
  const [experimentClient, fragmentText, updatesText, packageText] =
    await Promise.all([
      readFile(experimentClientUrl, "utf8"),
      readFile(experimentManifestFragmentUrl, "utf8"),
      readFile(headerControlsUpdatesUrl, "utf8"),
      readFile(packageUrl, "utf8"),
    ]);
  const fragment = JSON.parse(fragmentText);
  const updates = JSON.parse(updatesText);
  const packageJson = JSON.parse(packageText);
  const update = updates.addons["iOSNotes@siliconvenice.net"].updates.at(-1);

  assert.match(experimentClient, /browser\.notesHeader\.setNoteMode/);
  assert.match(experimentClient, /browser\.notesHeader\.onNewNote/);
  assert.equal(
    fragment.browser_specific_settings.gecko.update_url,
    "https://raw.githubusercontent.com/ecxod/iOS-IMAP-Notes/master/updates/header-controls.json",
  );
  assert.equal(update.version, packageJson.version);
  assert.equal(
    update.update_link,
    `https://github.com/ecxod/iOS-IMAP-Notes/releases/download/v${packageJson.version}/thunderbird-ios-imap-notes-${packageJson.version}-header-controls.xpi`,
  );
  assert.match(update.update_link, /^https:\/\//);
  assert.match(update.update_hash, /^sha256:[0-9a-f]{64}$/);
});
