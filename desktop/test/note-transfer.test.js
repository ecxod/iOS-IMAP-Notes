const test = require("node:test");
const assert = require("node:assert/strict");
const {
  destinationAccounts,
  transferContent,
  transferNoteSafely,
} = require("../note-transfer");

const source = {
  id: "source-note",
  title: "Original",
  bodyHtml: "<p>Original</p>",
  images: [],
  conversation: { id: "conversation" },
  home: { kind: "imap", accountId: "source-account" },
};

test("offers only enabled destination servers other than the source server", () => {
  assert.deepEqual(
    destinationAccounts([
      { id: "source-account", enabled: true },
      { id: "destination", enabled: true },
      { id: "disabled", enabled: false },
    ], source).map(account => account.id),
    ["destination"],
  );
});

test("uses the selected note draft while preserving hidden conversation identity", () => {
  assert.deepEqual(transferContent(source, {
    id: source.id,
    title: "Edited",
    bodyHtml: "<p>Edited</p>",
    images: [{ contentId: "image@example" }],
  }), {
    title: "Edited",
    bodyHtml: "<p>Edited</p>",
    images: [{ contentId: "image@example" }],
    conversation: source.conversation,
  });
});

test("persists the destination before removing the source during a move", async () => {
  const events = [];
  const result = await transferNoteSafely({
    mode: "move",
    source,
    createDestination: async content => {
      events.push(["create", content.title]);
      return { ...source, id: "destination-note" };
    },
    persistState: async state => events.push(["persist", state.sourceRemoved]),
    deleteSource: async () => events.push(["delete"]),
  });
  assert.deepEqual(events, [
    ["create", "Original"],
    ["persist", false],
    ["delete"],
    ["persist", true],
  ]);
  assert.equal(result.sourceRemoved, true);
});

test("keeps both notes when source deletion fails", async () => {
  const persisted = [];
  let deletes = 0;
  const result = await transferNoteSafely({
    mode: "move",
    source,
    createDestination: async () => ({ ...source, id: "destination-note" }),
    persistState: async state => persisted.push(state.sourceRemoved),
    deleteSource: async () => {
      deletes += 1;
      throw new Error("source unavailable");
    },
  });
  assert.deepEqual(persisted, [false]);
  assert.equal(deletes, 1);
  assert.equal(result.sourceRemoved, false);
  assert.match(result.warning, /copied to the destination.*source unavailable/);
});

test("copy never removes its source", async () => {
  let deletes = 0;
  const result = await transferNoteSafely({
    mode: "copy",
    source,
    createDestination: async () => ({ ...source, id: "destination-note" }),
    persistState: async () => {},
    deleteSource: async () => { deletes += 1; },
  });
  assert.equal(deletes, 0);
  assert.equal(result.sourceRemoved, false);
});
