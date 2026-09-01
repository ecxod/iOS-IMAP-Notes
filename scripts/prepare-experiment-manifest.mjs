import { readFile, writeFile } from "node:fs/promises";

const [manifestPath, fragmentPath] = process.argv.slice(2);
if (!manifestPath || !fragmentPath) {
  throw new Error("Usage: prepare-experiment-manifest.mjs <manifest> <fragment>");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fragment = JSON.parse(await readFile(fragmentPath, "utf8"));

Object.assign(
  manifest.browser_specific_settings.gecko,
  fragment.browser_specific_settings.gecko,
);
manifest.experiment_apis = fragment.experiment_apis;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
