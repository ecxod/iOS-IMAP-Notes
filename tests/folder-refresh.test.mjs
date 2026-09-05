import assert from "node:assert/strict";
import test from "node:test";
import {
  findAlternateFolder,
  refreshDisplayedFolder,
} from "../scripts/folder-refresh.mjs";

const currentFolder = {
  accountId: "account-1",
  id: "notes",
  name: "Notes",
  type: "none",
};

const account = {
  rootFolder: {
    accountId: "account-1",
    id: "root",
    isRoot: true,
    subFolders: [
      currentFolder,
      { accountId: "account-1", id: "archive", name: "Archive", type: "none" },
      { accountId: "account-1", id: "inbox", name: "Inbox", type: "inbox" },
    ],
  },
};

test("the standards-only refresh fallback prefers Inbox", () => {
  assert.equal(findAlternateFolder(account, currentFolder)?.id, "inbox");
});

test("refresh temporarily selects another folder and restores the Notes folder", async () => {
  const updates = [];
  const api = {
    accounts: { get: async () => account },
    mailTabs: {
      get: async () => ({ displayedFolder: currentFolder }),
      update: async (tabId, properties) => {
        updates.push({ tabId, folder: properties.displayedFolder.id });
      },
    },
  };

  assert.equal(await refreshDisplayedFolder(api, 7), true);
  assert.deepEqual(updates, [
    { tabId: 7, folder: "inbox" },
    { tabId: 7, folder: "notes" },
  ]);
});

test("refresh reports when an account has no alternate selectable folder", async () => {
  const api = {
    accounts: {
      get: async () => ({
        rootFolder: { id: "root", isRoot: true, subFolders: [currentFolder] },
      }),
    },
    mailTabs: { get: async () => ({ displayedFolder: currentFolder }) },
  };

  assert.equal(await refreshDisplayedFolder(api, 7), false);
});
