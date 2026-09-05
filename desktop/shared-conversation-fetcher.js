const { randomUUID } = require("node:crypto");
const { normalizeConversation, parseSharedUrl } = require("./conversation-import");

const LOAD_TIMEOUT = 30_000;

function extractionScript(provider, citationGroups = []) {
  if (provider === "gemini") {
    return `(() => {
      const citationGroups = ${JSON.stringify(citationGroups)};
      const turns = [];
      for (const [assistantIndex, container] of [...document.querySelectorAll("share-turn-viewer")].entries()) {
        const turnId = container.id || String(turns.length);
        const user = container.querySelector(".query-text-line")?.innerText?.trim();
        const response = container.querySelector("response-container .markdown")
          || container.querySelector("response-container message-content");
        const assistant = response?.innerText?.trim();
        let assistantHtml = "";
        if (response) {
          const clone = response.cloneNode(true);
          const groups = citationGroups.filter(group => group.assistantIndex === assistantIndex);
          const missingGroups = [];
          for (const group of groups) {
            const chip = clone.querySelectorAll("source-inline-chip")[group.chipIndex];
            if (!chip || !group.links?.length) {
              if (group.links?.length) missingGroups.push(group);
              continue;
            }
            const citation = document.createElement("span");
            citation.append(" [");
            group.links.forEach((source, index) => {
              if (index) citation.append(", ");
              const link = document.createElement("a");
              link.href = source.href;
              link.textContent = source.text || "Source";
              citation.append(link);
            });
            citation.append("]");
            (chip.closest("sources-carousel-inline") || chip).replaceWith(citation);
          }
          if (missingGroups.length) {
            const sources = document.createElement("p");
            const label = document.createElement("strong");
            label.textContent = "Sources: ";
            sources.append(label);
            missingGroups.flatMap(group => group.links).forEach((source, index) => {
              if (index) sources.append(", ");
              const link = document.createElement("a");
              link.href = source.href;
              link.textContent = source.text || "Source";
              sources.append(link);
            });
            clone.append(sources);
          }

          const sourceBlocks = [...response.querySelectorAll("code-block")];
          [...clone.querySelectorAll("code-block")].forEach((block, index) => {
            const sourceBlock = sourceBlocks[index];
            if (!sourceBlock?.innerText?.trim()) {
              block.remove();
              return;
            }
            const sourceCode = sourceBlock.querySelector('pre code[data-test-id="code-content"]');
            const outputCode = sourceBlock.querySelector('pre code[data-test-id="code-output-stdout-stderr"]');
            const fragment = document.createDocumentFragment();
            const codeText = sourceCode?.innerText?.trimEnd() || "";
            const visibleText = sourceBlock.innerText.trim();
            const firstLine = visibleText.split("\\n")[0]?.trim() || "";
            if (firstLine && codeText && firstLine !== codeText.split("\\n")[0]?.trim()) {
              const label = document.createElement("p");
              const strong = document.createElement("strong");
              strong.textContent = firstLine;
              label.append(strong);
              fragment.append(label);
            }
            if (codeText) {
              const pre = document.createElement("pre");
              const code = document.createElement("code");
              code.textContent = codeText;
              pre.append(code);
              fragment.append(pre);
            }
            const outputText = outputCode?.innerText?.trimEnd() || "";
            if (outputText) {
              const label = document.createElement("p");
              const strong = document.createElement("strong");
              strong.textContent = "Code output";
              label.append(strong);
              const pre = document.createElement("pre");
              const code = document.createElement("code");
              code.textContent = outputText;
              pre.append(code);
              fragment.append(label, pre);
            }
            block.replaceWith(fragment);
          });

          const sourceFiles = [...response.querySelectorAll("generated-file")];
          [...clone.querySelectorAll("generated-file")].forEach((file, index) => {
            const details = (sourceFiles[index]?.innerText || "")
              .split("\\n")
              .map(line => line.trim())
              .filter(line => line && line.toLowerCase() !== "open");
            if (!details.length) {
              file.remove();
              return;
            }
            const summary = document.createElement("p");
            const label = document.createElement("strong");
            label.textContent = "Generated file: ";
            summary.append(label, details.join(" · "));
            file.replaceWith(summary);
          });
          clone.querySelectorAll("button, source-footnote, source-inline-chip, sources-carousel-inline")
            .forEach(node => node.remove());
          assistantHtml = clone.innerHTML.trim();
        }
        if (user) turns.push({ id: turnId + ":user", role: "user", text: user });
        if (assistant) turns.push({
          id: turnId + ":assistant",
          role: "assistant",
          text: assistant,
          html: assistantHtml,
        });
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
        html: node.innerHTML?.trim() || "",
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

async function dismissGeminiCookieDialog(window) {
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(candidate => {
      const text = candidate.innerText?.trim().toLowerCase();
      return text === "reject all" || text === "alle ablehnen";
    });
    if (button) button.click();
  })()`, true);
}

async function collectGeminiCitationGroups(window, deadline) {
  const groups = [];
  await dismissGeminiCookieDialog(window);
  await delay(300);
  let count = 0;
  const sourceDeadline = Math.min(deadline, Date.now() + 1_500);
  while (!count && Date.now() < sourceDeadline) {
    count = await window.webContents.executeJavaScript(
      `document.querySelectorAll("response-container .markdown source-inline-chip button").length`,
      true,
    );
    if (!count) await delay(150);
  }
  for (let index = 0; index < Math.min(Number(count) || 0, 40) && Date.now() < deadline; index += 1) {
    const location = await window.webContents.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll("response-container .markdown source-inline-chip button")];
      const button = buttons[${index}];
      if (!button) return null;
      button.scrollIntoView({ block: "center", inline: "center" });
      const response = button.closest("response-container");
      const responses = [...document.querySelectorAll("share-turn-viewer response-container")];
      const chip = button.closest("source-inline-chip");
      const chips = response ? [...response.querySelectorAll(".markdown source-inline-chip")] : [];
      const rect = button.getBoundingClientRect();
      return {
        assistantIndex: responses.indexOf(response),
        chipIndex: chips.indexOf(chip),
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      };
    })()`, true);
    if (!location || location.assistantIndex < 0 || location.chipIndex < 0) {
      continue;
    }
    window.webContents.sendInputEvent({
      type: "mouseDown", x: location.x, y: location.y, button: "left", clickCount: 1,
    });
    window.webContents.sendInputEvent({
      type: "mouseUp", x: location.x, y: location.y, button: "left", clickCount: 1,
    });
    let links = [];
    const overlayDeadline = Math.min(deadline, Date.now() + 1_200);
    while (Date.now() < overlayDeadline) {
      links = await window.webContents.executeJavaScript(`(() => {
        const anchors = [...document.querySelectorAll(
          '[role="dialog"] a[href], mat-bottom-sheet-container a[href], .cdk-overlay-container a[href]'
        )];
        const seen = new Set();
        return anchors.map(anchor => {
          const href = anchor.href;
          if (!/^https?:\\/\\//i.test(href) || seen.has(href)) return null;
          seen.add(href);
          const lines = (anchor.innerText || "").split("\\n").map(line => line.trim()).filter(Boolean);
          return { href, text: lines[0] || new URL(href).hostname };
        }).filter(Boolean);
      })()`, true);
      if (links.length) break;
      await delay(100);
    }
    if (links.length) {
      groups.push({
        assistantIndex: location.assistantIndex,
        chipIndex: location.chipIndex,
        links,
      });
    }
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await delay(100);
  }
  return groups;
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
    if (requested.provider === "gemini") {
      let citationGroups = [];
      try {
        citationGroups = await collectGeminiCitationGroups(window, deadline);
      } catch {
        // Formatting and text import still work if Gemini changes its citation overlay.
      }
      extracted = await window.webContents.executeJavaScript(
        extractionScript(requested.provider, citationGroups),
        true,
      );
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
  collectGeminiCitationGroups,
  extractionScript,
  fetchSharedConversation,
};
