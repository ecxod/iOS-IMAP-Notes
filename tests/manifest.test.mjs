import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../manifest.json", import.meta.url);

test("Mail Experiments declare a strict maximum Thunderbird version", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const gecko = manifest.browser_specific_settings?.gecko;

  if (manifest.experiment_apis || manifest.theme_experiment) {
    assert.match(
      gecko?.strict_max_version || "",
      /^\d+\.\*$/,
      "strict_max_version is required for Thunderbird Mail Experiments",
    );
  }
});
