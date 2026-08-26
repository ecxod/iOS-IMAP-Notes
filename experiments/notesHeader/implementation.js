"use strict";

const NEW_NOTE_BUTTON_ID = "ios-imap-notes-new-note-button";
const NOTE_MODE_CLASS = "ios-imap-notes-header-mode";
const STYLE_ID = "ios-imap-notes-header-style";
const trackedDocuments = new Set();
const newNoteCallbacks = new Set();
const originalButtonStates = new Map();
const NATIVE_ACTION_IDS = [
  "hdrReplyToSenderButton",
  "hdrSmartReplyButton",
  "hdrForwardButton",
  "hdrArchiveButton",
  "hdrJunkButton",
  "hdrTrashButton",
  "otherActionsButton",
  "starMessageButton",
];

function getMessageWindow(context, tabId) {
  const { nativeTab } = context.extension.tabManager.get(tabId);

  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser?.contentWindow || null;
  }
  if (nativeTab?.mode?.name === "mail3PaneTab") {
    return nativeTab.chromeBrowser?.contentWindow?.messageBrowser?.contentWindow || null;
  }
  if (nativeTab?.mode?.name === "mailMessageTab") {
    return nativeTab.chromeBrowser?.contentWindow || null;
  }
  return null;
}

function ensureStyle(document) {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root.${NOTE_MODE_CLASS} #hdrReplyToSenderButton,
    :root.${NOTE_MODE_CLASS} #hdrSmartReplyButton,
    :root.${NOTE_MODE_CLASS} #hdrForwardButton,
    :root.${NOTE_MODE_CLASS} #hdrArchiveButton,
    :root.${NOTE_MODE_CLASS} #hdrJunkButton,
    :root.${NOTE_MODE_CLASS} #hdrTrashButton,
    :root.${NOTE_MODE_CLASS} #otherActionsButton,
    :root.${NOTE_MODE_CLASS} #starMessageButton {
      opacity: 0.5 !important;
      pointer-events: none !important;
    }
  `;
  document.head.append(style);
}

function disableNativeActions(document) {
  let states = originalButtonStates.get(document);
  if (!states) {
    states = new Map();
    originalButtonStates.set(document, states);
  }

  for (const id of NATIVE_ACTION_IDS) {
    const button = document.getElementById(id);
    if (!button) {
      continue;
    }
    if (!states.has(button)) {
      states.set(button, {
        ariaDisabled: button.hasAttribute("aria-disabled")
          ? button.getAttribute("aria-disabled")
          : null,
        inert: button.hasAttribute("inert")
          ? button.getAttribute("inert")
          : null,
        tabIndex: button.hasAttribute("tabindex")
          ? button.getAttribute("tabindex")
          : null,
      });
    }
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("inert", "");
    button.setAttribute("tabindex", "-1");
  }
}

function restoreNativeActions(document) {
  const states = originalButtonStates.get(document);
  if (!states) {
    return;
  }

  for (const [button, state] of states) {
    if (state.ariaDisabled == null) {
      button.removeAttribute("aria-disabled");
    } else {
      button.setAttribute("aria-disabled", state.ariaDisabled);
    }
    if (state.inert == null) {
      button.removeAttribute("inert");
    } else {
      button.setAttribute("inert", state.inert);
    }
    if (state.tabIndex == null) {
      button.removeAttribute("tabindex");
    } else {
      button.setAttribute("tabindex", state.tabIndex);
    }
  }
  originalButtonStates.delete(document);
}

function ensureNewNoteButton(context, document, tabId, label) {
  let button = document.getElementById(NEW_NOTE_BUTTON_ID);
  if (!button) {
    const toolbar = document.getElementById("header-view-toolbar");
    if (!toolbar) {
      return null;
    }

    button = document.createXULElement("toolbarbutton");
    button.id = NEW_NOTE_BUTTON_ID;
    button.classList.add(
      "toolbarbutton-1",
      "message-header-view-button",
      "ios-imap-notes-new-note-button",
    );
    button.setAttribute(
      "image",
      context.extension.rootURI.resolve("images/iOSNotes.png"),
    );
    button.addEventListener("command", () => {
      for (const callback of newNoteCallbacks) {
        callback(tabId);
      }
    });
    toolbar.append(button);
  }

  button.setAttribute("label", label);
  button.setAttribute("tooltiptext", label);
  return button;
}

function setNoteMode(context, tabId, enabled, label) {
  const window = getMessageWindow(context, tabId);
  const document = window?.document;
  if (!document) {
    return false;
  }

  ensureStyle(document);
  const button = ensureNewNoteButton(context, document, tabId, label);
  if (!button) {
    return false;
  }

  document.documentElement.classList.toggle(NOTE_MODE_CLASS, enabled);
  button.hidden = !enabled;
  if (enabled) {
    disableNativeActions(document);
  } else {
    restoreNativeActions(document);
  }
  trackedDocuments.add(document);
  return true;
}

function cleanDocument(document) {
  document.documentElement?.classList.remove(NOTE_MODE_CLASS);
  restoreNativeActions(document);
  document.getElementById(NEW_NOTE_BUTTON_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

var notesHeader = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    context.callOnClose({
      close() {
        for (const document of trackedDocuments) {
          cleanDocument(document);
        }
        trackedDocuments.clear();
        originalButtonStates.clear();
        newNoteCallbacks.clear();
      },
    });

    return {
      notesHeader: {
        setNoteMode(tabId, enabled, newNoteLabel) {
          return setNoteMode(context, tabId, enabled, newNoteLabel);
        },

        onNewNote: new ExtensionCommon.EventManager({
          context,
          name: "notesHeader.onNewNote",
          register(fire) {
            const callback = tabId => fire.async(tabId);
            newNoteCallbacks.add(callback);
            return () => newNoteCallbacks.delete(callback);
          },
        }).api(),
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    for (const document of trackedDocuments) {
      cleanDocument(document);
    }
    trackedDocuments.clear();
    originalButtonStates.clear();
    newNoteCallbacks.clear();
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  }
};
