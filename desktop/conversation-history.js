const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const git = require("isomorphic-git");

const ID_PATTERN = /^[a-z0-9-]{8,80}$/i;

function conversationDirectory(root, conversationId) {
  if (!ID_PATTERN.test(String(conversationId || ""))) {
    throw new Error("Invalid conversation history ID.");
  }
  return path.join(root, "conversations", conversationId);
}

async function ensureRepository(root) {
  await fsp.mkdir(root, { recursive: true });
  try {
    await fsp.access(path.join(root, ".git"));
  } catch {
    await git.init({ fs, dir: root, defaultBranch: "main" });
    await fsp.writeFile(
      path.join(root, "README.txt"),
      "Private local version history for imported AI conversations.\nDo not publish this repository.\n",
      "utf8",
    );
  }
}

async function readConversationState(root, conversationId) {
  try {
    return JSON.parse(await fsp.readFile(
      path.join(conversationDirectory(root, conversationId), "current.json"),
      "utf8",
    ));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function commitConversationVersion(root, input) {
  await ensureRepository(root);
  const directory = conversationDirectory(root, input.conversationId);
  await fsp.mkdir(directory, { recursive: true });
  const state = {
    version: 1,
    conversationId: input.conversationId,
    provider: input.provider,
    shareIds: input.shareIds,
    snapshot: input.snapshot,
    note: {
      id: input.note.id,
      title: input.note.title,
      updatedAt: input.note.updatedAt,
      home: input.note.home,
    },
    committedAt: new Date().toISOString(),
  };
  const relativeDirectory = path.relative(root, directory).split(path.sep).join("/");
  const statePath = path.join(directory, "current.json");
  const notePath = path.join(directory, "note.html");
  await Promise.all([
    fsp.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8"),
    fsp.writeFile(notePath, String(input.note.bodyHtml || ""), "utf8"),
  ]);
  for (const filepath of ["README.txt", `${relativeDirectory}/current.json`, `${relativeDirectory}/note.html`]) {
    await git.add({ fs, dir: root, filepath });
  }
  const oid = await git.commit({
    fs,
    dir: root,
    message: String(input.message || "Update imported conversation"),
    author: {
      name: "iOS IMAP Notes",
      email: "local-history@ios-imap-notes.invalid",
    },
  });
  return { oid, root };
}

module.exports = {
  commitConversationVersion,
  conversationDirectory,
  ensureRepository,
  readConversationState,
};
