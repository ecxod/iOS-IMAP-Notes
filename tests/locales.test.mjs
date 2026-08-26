import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const localesDirectory = new URL("../_locales/", import.meta.url);

test("locale message names are unique without regard to case", async () => {
  const locales = await readdir(localesDirectory, { withFileTypes: true });

  for (const locale of locales.filter((entry) => entry.isDirectory())) {
    const messagesUrl = new URL(`${locale.name}/messages.json`, localesDirectory);
    const messages = JSON.parse(await readFile(messagesUrl, "utf8"));
    const seen = new Map();

    for (const name of Object.keys(messages)) {
      const normalizedName = name.toLocaleLowerCase("en-US");
      assert.equal(
        seen.has(normalizedName),
        false,
        `${locale.name}: message names ${seen.get(normalizedName)} and ${name} differ only by case`,
      );
      seen.set(normalizedName, name);
    }
  }
});
