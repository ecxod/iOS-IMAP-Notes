const { createHash, randomUUID } = require("node:crypto");
const sanitizeHtml = require("sanitize-html");

const TURN_HTML_OPTIONS = Object.freeze({
  allowedTags: [
    "a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "span", "strong",
    "table", "tbody", "td", "th", "thead", "tr", "ul",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    code: ["class"],
    ol: ["start"],
    td: ["align"],
    th: ["align"],
  },
  allowedClasses: {
    code: [/^language-[a-z0-9_-]+$/i],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
});

const PROVIDERS = Object.freeze({
  chatgpt: {
    label: "ChatGPT",
    hosts: new Set(["chatgpt.com"]),
    pathPattern: /^\/share\/([a-z0-9-]+)\/?$/i,
  },
  gemini: {
    label: "Gemini",
    hosts: new Set(["share.gemini.google", "gemini.google.com"]),
    pathPattern: /^\/(?:share\/)?([a-z0-9_-]+)\/?$/i,
  },
});

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function providerDefinition(provider) {
  const definition = PROVIDERS[String(provider || "").toLowerCase()];
  if (!definition) {
    throw new Error("Unsupported conversation provider.");
  }
  return definition;
}

function parseSharedUrl(rawUrl, expectedProvider) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Enter a valid public conversation link.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Conversation links must use HTTPS.");
  }
  const provider = String(expectedProvider || "").toLowerCase();
  const definition = providerDefinition(provider);
  if (!definition.hosts.has(url.hostname.toLowerCase())) {
    throw new Error(`This is not a public ${definition.label} link.`);
  }
  const match = url.pathname.match(definition.pathPattern);
  if (!match) {
    throw new Error(`This is not a supported ${definition.label} share URL.`);
  }
  return { provider, shareId: match[1], url: url.href };
}

function providerForSharedUrl(rawUrl) {
  for (const provider of Object.keys(PROVIDERS)) {
    try {
      parseSharedUrl(rawUrl, provider);
      return provider;
    } catch {
      // Try the next supported provider.
    }
  }
  throw new Error("Enter a supported public Gemini or ChatGPT conversation link.");
}

function normalizeTurn(value, index) {
  const role = value?.role === "user" ? "user" : value?.role === "assistant" ? "assistant" : "";
  const text = String(value?.text || "").replace(/\r\n?/g, "\n").trim();
  if (!role || !text) {
    return null;
  }
  const contentHash = hash(`${role}\n${text.normalize("NFKC")}`);
  const normalized = {
    id: String(value.id || `${index}-${contentHash.slice(0, 16)}`),
    role,
    text,
    hash: contentHash,
  };
  const html = sanitizeTurnHtml(value?.html);
  if (html) {
    normalized.html = html;
  }
  return normalized;
}

function sanitizeTurnHtml(value) {
  return sanitizeHtml(String(value || ""), {
    ...TURN_HTML_OPTIONS,
    exclusiveFilter(frame) {
      return frame.tag === "a" && !frame.attribs.href;
    },
  }).trim();
}

function normalizeConversation(value) {
  const parsedUrl = parseSharedUrl(value?.url, value?.provider);
  const turns = (Array.isArray(value?.turns) ? value.turns : [])
    .map(normalizeTurn)
    .filter(Boolean);
  if (!turns.length || !turns.some(turn => turn.role === "assistant")) {
    throw new Error(`The public ${providerDefinition(parsedUrl.provider).label} conversation could not be read.`);
  }
  return {
    provider: parsedUrl.provider,
    shareId: parsedUrl.shareId,
    url: parsedUrl.url,
    turns,
    revision: hash(JSON.stringify(turns.map(turn => turn.hash))),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textHtml(text) {
  return escapeHtml(text).split("\n").map(line => line || "<br>").join("<br>");
}

function renderTurns(turns) {
  return turns.map(turn => (
    `<section data-conversation-turn="${escapeHtml(turn.hash)}">`
      + `<h3>${turn.role === "user" ? "You" : "Assistant"}</h3>`
      + `<div>${turn.html || textHtml(turn.text)}</div>`
      + "</section>"
  )).join("\n");
}

function renderConversation(conversation) {
  return renderTurns(conversation.turns);
}

function conversationNoteTitle(conversation) {
  const firstPrompt = conversation.turns.find(turn => turn.role === "user")?.text || "";
  return firstPrompt.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 500)
    || `${providerDefinition(conversation.provider).label} conversation`;
}

function turnHashes(conversation) {
  return (conversation?.turns || []).map(turn => turn.hash || normalizeTurn(turn, 0)?.hash).filter(Boolean);
}

function conversationSimilarity(left, right) {
  if (!left || !right || left.provider !== right.provider) {
    return { score: 0, commonTurns: 0, exactPrefix: false };
  }
  const leftHashes = turnHashes(left);
  const rightHashes = turnHashes(right);
  let commonTurns = 0;
  while (commonTurns < leftHashes.length
      && commonTurns < rightHashes.length
      && leftHashes[commonTurns] === rightHashes[commonTurns]) {
    commonTurns += 1;
  }
  const shortest = Math.min(leftHashes.length, rightHashes.length);
  const score = shortest ? commonTurns / shortest : 0;
  return {
    score,
    commonTurns,
    exactPrefix: commonTurns === shortest,
    leftTurns: leftHashes.length,
    rightTurns: rightHashes.length,
  };
}

function isLikelyContinuation(similarity) {
  return similarity.exactPrefix
    && similarity.rightTurns >= similarity.leftTurns
    && similarity.score >= 0.8
    && similarity.commonTurns >= 2;
}

function mergeConversation(base, localNote, remote) {
  const baseBodyHtml = renderConversation(base);
  const remoteBodyHtml = renderConversation(remote);
  let body;
  if (String(localNote.bodyHtml || "") === baseBodyHtml) {
    body = { value: remoteBodyHtml, conflict: false, appendedTurns: remote.turns.length - base.turns.length };
  } else {
    const similarity = conversationSimilarity(base, remote);
    if (similarity.exactPrefix && remote.turns.length >= base.turns.length) {
      const additions = remote.turns.slice(base.turns.length);
      body = {
        value: additions.length
          ? `${String(localNote.bodyHtml || "")}\n${renderTurns(additions)}`
          : String(localNote.bodyHtml || ""),
        conflict: false,
        appendedTurns: additions.length,
      };
    } else {
      body = { value: String(localNote.bodyHtml || ""), conflict: true, appendedTurns: 0 };
    }
  }
  return {
    title: String(localNote.title || conversationNoteTitle(remote)),
    bodyHtml: body.value,
    conflict: body.conflict,
    titleConflict: false,
    bodyConflict: body.conflict,
    appendedTurns: body.appendedTurns,
  };
}

function conversationMetadata(existing, remote, conversationId = randomUUID()) {
  const shareIds = [...new Set([
    ...(Array.isArray(existing?.shareIds) ? existing.shareIds : []),
    remote.shareId,
  ].map(String).filter(Boolean))].slice(-50);
  return {
    id: String(existing?.id || conversationId),
    provider: remote.provider,
    shareIds,
    latestShareUrl: remote.url,
    latestSourceRevision: remote.revision,
  };
}

module.exports = {
  PROVIDERS,
  conversationNoteTitle,
  conversationMetadata,
  conversationSimilarity,
  isLikelyContinuation,
  mergeConversation,
  normalizeConversation,
  parseSharedUrl,
  providerForSharedUrl,
  renderConversation,
  renderTurns,
  sanitizeTurnHtml,
};
