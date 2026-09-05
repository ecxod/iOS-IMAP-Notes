const { randomUUID } = require("node:crypto");
const { normalizeConversation, parseSharedUrl } = require("./conversation-import");

const LOAD_TIMEOUT = 30_000;

function extractionScript(provider) {
  if (provider === "gemini") {
    return `(() => {
      const turns = [];
      for (const container of document.querySelectorAll("share-turn-viewer")) {
        const turnId = container.id || String(turns.length);
        const user = container.querySelector(".query-text-line")?.innerText?.trim();
        const assistant = container.querySelector("response-container .markdown")?.innerText?.trim()
          || container.querySelector("response-container message-content")?.innerText?.trim();
        if (user) turns.push({ id: turnId + ":user", role: "user", text: user });
        if (assistant) turns.push({ id: turnId + ":assistant", role: "assistant", text: assistant });
      }
      return {
        provider: "gemini",
        url: location.href,
        turns,
      };
    })()`;
  }
  return `(() => ({
    provider: "chatgpt",
    url: location.href,
    turns: [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')]
      .map((node, index) => ({
        id: node.getAttribute("data-message-id")
          || node.closest("[data-message-id]")?.getAttribute("data-message-id")
          || String(index),
        role: node.getAttribute("data-message-author-role"),
        text: node.innerText?.trim() || "",
      })),
  }))()`;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function assertAllowedNavigation(rawUrl, provider) {
  parseSharedUrl(rawUrl, provider);
  return true;
}

async function fetchSharedConversation(BrowserWindow, rawUrl, provider, timeout = LOAD_TIMEOUT) {
  const requested = parseSharedUrl(rawUrl, provider);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `conversation-import:${randomUUID()}`,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const guardNavigation = (event, targetUrl) => {
    try {
      assertAllowedNavigation(targetUrl, requested.provider);
    } catch {
      event.preventDefault();
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);

  const deadline = Date.now() + timeout;
  try {
    await Promise.race([
      window.loadURL(requested.url),
      delay(timeout).then(() => { throw new Error("Timed out while loading the public conversation."); }),
    ]);
    let extracted = null;
    while (Date.now() < deadline) {
      extracted = await window.webContents.executeJavaScript(extractionScript(requested.provider), true);
      if (Array.isArray(extracted?.turns) && extracted.turns.some(turn => turn.role === "assistant")) {
        break;
      }
      await delay(400);
    }
    if (!extracted?.turns?.length) {
      throw new Error(`The public ${requested.provider === "gemini" ? "Gemini" : "ChatGPT"} conversation did not load.`);
    }
    assertAllowedNavigation(extracted.url, requested.provider);
    return normalizeConversation(extracted);
  } finally {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

module.exports = {
  extractionScript,
  fetchSharedConversation,
};
