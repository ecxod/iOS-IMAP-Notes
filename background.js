async function getOpenNotesEditor() {
  let url = await browser.runtime.getURL("/editor/iOSNotes.html");
  return browser.windows
    .getAll({populate: true, windowTypes: ["popup"]})
    .then(popups => popups.find(p => {console.log(p); return p.tabs[0].url.startsWith(url)}))
};

async function openNotesEditor(info, tab) {
  if (info.menuItemId != "iOSNotesEdit") {
    return;
  };
  
  let { messages } = info.selectedMessages;
  if (messages.length != 1) {
    return;
  }

  if (await getOpenNotesEditor()) {
    return;
  }

  browser.windows.create({
    type: "popup",
    url: `/editor/iOSNotes.html?tabId=${tab.id}&messageId=${messages[0].id}`,
    allowScriptsToClose: true,    
  });
}


//add listener for keyboard shortcut
browser.commands.onCommand.addListener(function (command, tab) {
if (command === "open-ios-editor") {
   

browser.tabs.query({ active: true, currentWindow: true }, function(tabs) {
  // 'tabs' will contain an array with the currently active tab
  var tab = tabs[0];
        
  // Check if 'tab' is defined
  if (tab) {
    // Access the Message
    browser.messageDisplay.getDisplayedMessage(tab.id).then(function(message) {
      if (message) {
        // 'message' contains information about the currently displayed email message        
          browser.windows.create({
            type: "popup",
            url: `/editor/iOSNotes.html?tabId=${tab.id}&messageId=${message.id}`,
            allowScriptsToClose: true,    
          });        
        // You can access other properties of the message object as well
      } else {
        console.log("No message is displayed in the current tab.");
      }
    }).catch(function(error) {
      console.error("Error getting displayed message:", error);
    });
  } else {
    console.log("No active tab found.");
  }
});
}
});

async function init() {
    // Disable the menu entry, if not exactly one note is selected.
    browser.menus.onShown.addListener(async (info, tab) => {
      if (!info.menuIds.includes("iOSNotesEdit")) {
        return;
      }
      let { messages } = info.selectedMessages;
      let openEditorPopup = await getOpenNotesEditor();
      await browser.menus.update("iOSNotesEdit", { enabled: !openEditorPopup && messages.length == 1});
      await browser.menus.refresh();
    });

    // Add context menu entry.
    browser.menus.create({
      id: "iOSNotesEdit",
      title: browser.i18n.getMessage("iOSimapNotes"),
      contexts: ["message_list"],
      onclick: openNotesEditor
    });    
}

init();
