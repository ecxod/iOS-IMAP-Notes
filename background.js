async function getOpenNotesEditor() {
  let url = await browser.runtime.getURL("/editor/iOSNotes.html");
  return browser.windows
    .getAll({ populate: true, windowTypes: ["popup"] })
    .then(popups => popups.find(p => p.tabs[0]?.url.startsWith(url)));
}

async function openNotesEditor(info, tab) {
  if (info.menuItemId != "iOSNotesEdit") return;

  let { messages } = info.selectedMessages;
  if (messages.length != 1) return;

  if (await getOpenNotesEditor()) return;

  browser.windows.create({
    type: "popup",
    url: `/editor/iOSNotes.html?tabId=${tab.id}&messageId=${messages[0].id}`,
    allowScriptsToClose: true,
  });
}

// ===============================================
// NEU: Buttons im Header Pane bei Apple Notes ausblenden
// ===============================================
async function updateHeaderButtonsForNotes(tabId, message) {
  if (!message) return;

  try {
    const full = await browser.messages.getFull(message.id);
    const isAppleNote = full.headers["x-uniform-type-identifier"]?.[0]?.includes("com.apple.mail-note");

    // Nur bei Apple Notes die Buttons verstecken
    if (!isAppleNote) {
      // Falls vorher versteckt → wieder einblenden (wichtig beim Wechsel zu normaler Mail)
      await browser.tabs.removeCSS(tabId, { code: "/* ios-notes-header-cleanup */" });
      return;
    }

    const buttonsToHide = [
      "button-reply",
      "button-reply-all",
      "button-reply-list",
      "button-forward",
      "button-archive",
      "button-junk",
      //"button-delete",
      "dkimVerifierButton",     // DKIM Verifier Add-on Button
      //"button-tag",             // optional: auch Tag-Button verstecken
      // "button-star",         // Stern lassen wir stehen, sieht gut aus
    ];

    const css = `
      /* ios-notes-header-cleanup */
      ${buttonsToHide.map(id => `#${id} { display: none !important; }`).join("\n")}
      /* Optional: etwas mehr Platz schaffen */
      #messageHeader { padding-right: 10px !important; }
    `;

    await browser.tabs.insertCSS(tabId, {
      code: css,
      cssOrigin: "user",
      runAt: "document_idle",
      allFrames: false
    });

  } catch (e) {
    console.debug("iOS Notes Header Cleanup Error:", e);
  }
}

// Beim Anzeigen einer Nachricht
browser.messageDisplay.onMessageDisplayed.addListener((tab, message) => {
  updateHeaderButtonsForNotes(tab.id, message);
});

// Falls die Nachricht im gleichen Tab aktualisiert wird (z. B. nach Speichern der Note)
browser.messages.onUpdated.addListener((messageId) => {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (!tabs[0]) return;
    browser.messageDisplay.getDisplayedMessage(tabs[0].id).then(displayedMsg => {
      if (displayedMsg?.id === messageId) {
        updateHeaderButtonsForNotes(tabs[0].id, displayedMsg);
      }
    });
  });
});

// ===============================================
// Bestehender Code (unverändert)
// ===============================================

// Keyboard Shortcut
browser.commands.onCommand.addListener(function (command, tab) {
  if (command === "open-ios-editor") {
    browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];
      if (!currentTab) return;

      browser.messageDisplay.getDisplayedMessage(currentTab.id).then(function (message) {
        if (message) {
          browser.windows.create({
            type: "popup",
            url: `/editor/iOSNotes.html?tabId=${currentTab.id}&messageId=${message.id}`,
            allowScriptsToClose: true,
          });
        }
      }).catch(console.error);
    });
  }
});

async function init() {
  browser.menus.onShown.addListener(async (info, tab) => {
    if (!info.menuIds.includes("iOSNotesEdit")) return;

    let { messages } = info.selectedMessages || {};
    let openEditorPopup = await getOpenNotesEditor();

    await browser.menus.update("iOSNotesEdit", {
      enabled: !openEditorPopup && messages && messages.length === 1
    });
    await browser.menus.refresh();
  });

  browser.menus.create({
    id: "iOSNotesEdit",
    title: browser.i18n.getMessage("iOSimapNotes"),
    contexts: ["message_list"],
    onclick: openNotesEditor
  });
}

init();