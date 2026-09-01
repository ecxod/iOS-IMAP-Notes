import { readFile, writeFile } from "node:fs/promises";

const [manifestPath, fragmentPath] = process.argv.slice(2);
if (!manifestPath || !fragmentPath) {
  throw new Error("Usage: prepare-experiment-manifest.mjs <manifest> <fragment>");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const experimentApis = JSON.parse(await readFile(fragmentPath, "utf8"));

manifest.browser_specific_settings.gecko.strict_max_version = "154.*";
manifest.experiment_apis = experimentApis;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
