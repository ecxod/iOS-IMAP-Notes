const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureMailboxWithClient } = require("../imap-service");

test("ensureMailboxWithClient leaves an existing Notes mailbox unchanged", async () => {
  let creates = 0;
  const client = {
    list: async () => [{ path: "INBOX" }, { path: "Notes" }],
    mailboxCreate: async () => { creates += 1; },
  };
  assert.equal(await ensureMailboxWithClient(client, "Notes"), false);
  assert.equal(creates, 0);
});

test("ensureMailboxWithClient creates a missing Notes mailbox", async () => {
  const mailboxes = [{ path: "INBOX" }];
  const client = {
    list: async () => mailboxes,
    mailboxCreate: async path => { mailboxes.push({ path }); },
  };
  assert.equal(await ensureMailboxWithClient(client, "Notes"), true);
  assert.deepEqual(mailboxes, [{ path: "INBOX" }, { path: "Notes" }]);
});

test("ensureMailboxWithClient tolerates a simultaneous mailbox creation", async () => {
  let listed = 0;
  const client = {
    list: async () => (++listed === 1 ? [] : [{ path: "Notes" }]),
    mailboxCreate: async () => { throw new Error("Already exists"); },
  };
  assert.equal(await ensureMailboxWithClient(client, "Notes"), false);
});
