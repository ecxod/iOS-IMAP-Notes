import { getPref } from "../options/defaults.mjs";

async function parseNote(messageId) {
  try {
    // Store the parsed note globally on the window object.
    let note = {};
    note.full = await browser.messages.getFull(messageId);
    note.raw = note.full.parts[0].body;
    note.msgHeader = await browser.messages.get(messageId);  

    // Abort if this is not a valid note.
    if (      
      !note.full.headers["x-uniform-type-identifier"] ||
      !note.full.headers["x-uniform-type-identifier"].includes("com.apple.mail-note") ||
      !note.full.parts.length == 1
    ) {
      return false;
    }       

    // iOS device seem to introduce line breaks (\r\n) which lead to return null for htmlParts below so we remove them
    note.raw = note.raw.replace(/(\r\n|\n|\r)/gm,"");

    let lowerCaseNote = note.raw.toLowerCase();        
    // Try to parse html message or fallback to text.
    if (lowerCaseNote.includes("<body") && lowerCaseNote.includes("</body>")) {
      // Extract subject and html code outside of the body (the return value of the
      // editor is just the inner part, so we have to stitch it back together before
      // saving)
      let htmlParts = note.raw.match(/^(.*?)<body(.*?)>(.*?)<\/body>(.*)/);
      // parts is array with 5 elements:
      // - 0: raw
      // - 1: group 1 - before body tag
      // - 2: group 2 - body attributes
      // - 3: group 3 - note content (subject<div>...</div><div>...</div>)
      // - 4: group 4 - behind body tag
      note.htmlPrefix = `${htmlParts[1]}<body${htmlParts[2]}>`;
      note.htmlSuffix = `</body>${htmlParts[4]}`
      // Remove the redundant subject.
      let noteParts = htmlParts[3].match(/^(.*?)<div(.*)/);
      note.content = `<div${noteParts[2]}`;
    } else {
      // Simple text parsing as fallback.
      note.htmlPrefix = "";
      note.htmlSuffix = "";
      let noteParts = note.raw.match(/^(.*?)<div(.*)/);
      note.content = `<div${noteParts[2]}`;
    }

    return note;
  } catch (ex) {
    console.debug(ex);
  }
  return false;
}

async function init() {
  i18n.updateDocument();

  // https://github.com/JiHong88/SunEditor
  window.editor = SUNEDITOR.create(document.getElementById('editor'), {
    width: 'auto',
    fullScreenOffset: document.getElementById("control-area").offsetHeight,
    buttonList: [
      [
        'undo', 'redo',
      ],
      [
        'bold', 'underline', 'italic',
      ],
      [
        'showBlocks', 'codeView'
      ]
    ]
    // Language global object (default: en)
    //lang: SUNEDITOR_LANG['ko']
  });
  window.editor.core.toggleFullScreen();
  window.focus();

  document.getElementById("btn_save").addEventListener("click", () => save());
  //document.getElementById("btn_cancel").addEventListener("click", () => window.close());
  document.getElementById("editor").focus();

  // Get tabId and messageId from url parameter.
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const messageId = parseInt(urlParams.get('messageId'));
  window.tabId = parseInt(urlParams.get('tabId'));

  // Store the parsed note globally on the window object.
  window.note = await parseNote(messageId);
  if (!window.note) {
    window.alert(browser.i18n.getMessage("noiOSNote"));
    window.close();
    return;
  }
  
  try {
    document.getElementById("subjectBox").value = window.note.full.headers.subject[0];
  } catch (ex) {
    console.debug(ex)
  }
  window.editor.setContents(window.note.content);
}

async function save() {
  // Indicate busy to the user.
  setBusy(true);

  // Create a new RFC2822 message based on the header and body we have in
  // window.note.full.headers and window.editor.getContents.
  let noteContent = window.editor.getContents();
  console.log(noteContent);
  let headers = window.note.full.headers;
  let newNote = MimeText.createMimeMessage();
  let newSubject = document.getElementById("subjectBox").value;

  // Adjust the editor output: Replace all p tags by div tags.
  noteContent = noteContent.replace(/<p>/g, "<div>")
  noteContent = noteContent.replace(/<\/p>/g, "</div>")

  // Adjust editor output: The returned body is without <html> and <body> tags.
  noteContent = `${window.note.htmlPrefix}${newSubject}${noteContent}${window.note.htmlSuffix}`;

  // Adjust headers.
  for (let [name, value] of Object.entries(headers)) {
    // Might be a hack: We only take the first header value for this header, I have
    // not seen iOS notes being generated with multiple values per header.
    let headerValue = value[0];

    if (["content-type", "content-transfer-encoding", "x-mozilla-keys"].includes(name)) {
      continue;
    }

    // Both date and x-mail-created-date appear to require both having the same
    // time timezone offset, otherwise iOS may drop it. So we reformat both in UTC.
    if (name == "date") {
      headerValue = new Date().toUTCString();
    }
    //if (name == "x-mail-created-date") {
    //  headerValue = new Date(headerValue).toUTCString();
    //}

    if (name == "subject") {
      headerValue = newSubject;
    }

    if (name == "from") {
      // The MimeText lib needs special handling for the FROM header.
      headerValue = new MimeText.Mailbox(headerValue);
    }

    newNote.setHeader(name, headerValue);
  }

  newNote.addMessage({
    contentType: 'text/html',
    encoding: "8bit",
    data: noteContent,
  });

  let newNoteMsgHeader = await updateNote({
    origNoteMsgHeader: window.note.msgHeader,
    utf8NewNote: newNote.asRaw(),
    keepBackup: await getPref("putOriginalInTrash"),
  });

  if (newNoteMsgHeader) {    
    // Update the edited note to be the "current" one, so we can re-save.
    window.note = await parseNote(newNoteMsgHeader.id);
    if (!window.note) {
      window.alert(browser.i18n.getMessage("noiOSNote"));
      setBusy(false);
      window.close();
      return;
    }

    // Select the updated note.
    await browser.mailTabs.setSelectedMessages(window.tabId, [newNoteMsgHeader.id]);
  }
  
  setBusy(false);
  if (newNoteMsgHeader) {
    document.getElementById("ok").classList.remove("hidden");
    await new Promise(resolve => window.setTimeout(resolve, 100));
    document.getElementById("ok").classList.add("hidden");
  } else {
    document.getElementById("error").classList.remove("hidden");
    await new Promise(resolve => window.setTimeout(resolve, 100));
    document.getElementById("error").classList.add("hidden");
  } 
    
  window.close();
}

async function updateNote({ origNoteMsgHeader, utf8NewNote, keepBackup }) {
  let uid = crypto.randomUUID();
  let newMsgFile = new File([utf8NewNote], `${uid}.eml`, { type: 'message/rfc822' });

  // Operation is piped thru a local folder, since messages.import() does not work with imap.
  let localAccount = (await messenger.accounts.list(false)).find(account => account.type == "none");
  let localFolders = await messenger.folders.getSubFolders(localAccount, false);
  let trashFolder = localFolders.find(folder => folder.type == "trash");
  if (!trashFolder) {
    trashFolder = localFolders.find(folder => folder.name == "Trash");
  }
  if (!trashFolder) {
    trashFolder = await messenger.folders.create(localAccount, "Trash");
  }

  let newNoteHeader = await messenger.messages.import(newMsgFile, trashFolder, {
    flagged: origNoteMsgHeader.flagged,
    read: origNoteMsgHeader.read,
    tags: origNoteMsgHeader.tags
  });

  if (!newNoteHeader) {
    return false;
  }
  console.log("Created [" + origNoteMsgHeader.id + " -> " + newNoteHeader.id + "]");

  // Move new note from trash folder to real destination.
  let newMovedMsgHeader;
  try {
    let waitCounter = 0;
    newMovedMsgHeader = await new Promise((resolve, reject) => {
      let checkFolder = async () => {
        let page = await browser.messages.query({
          folder: origNoteMsgHeader.folder,
          headerMessageId: newNoteHeader.headerMessageId
        });
        do {
          let { messages } = page;
          let movedMessage = messages.find(m =>
            m.headerMessageId == newNoteHeader.headerMessageId &&
            m.id != origNoteMsgHeader.id
          );
          if (movedMessage) {
            console.log("Moved [" + newNoteHeader.id + " -> " + movedMessage.id + "]");
            resolve(movedMessage);
            return;
          }
          if (page.id) {
            page = await messenger.messages.continueList(page.id);
          } else {
            page = null;
          }
        } while (page && page.messages.length > 0)

        waitCounter++;
        if (waitCounter > 20) {
          reject(new Error("Note not found after update"));
        } else {
          window.setTimeout(checkFolder, 500);
        }
      }
      messenger.messages.move([newNoteHeader.id], origNoteMsgHeader.folder);
      checkFolder();
    })
  } catch (ex) {
    console.error(ex);
  }

  if (!newMovedMsgHeader) {
    return false;
  }

  // Remove or backup original note.
  if (keepBackup) {
    await messenger.messages.move([origNoteMsgHeader.id], trashFolder);
  } else {
    await messenger.messages.delete([origNoteMsgHeader.id], true);
  }
  return newMovedMsgHeader;
}

window.addEventListener("load", init, false);


// BUSY management, to prevent user from closing the popup window while we are busy.
function setBusy(isBusy) {
  window.isBusy = isBusy;
  document.getElementById("btn_save").disabled = isBusy;
  //document.getElementById("btn_cancel").disabled = isBusy;
  if (isBusy) {
    document.getElementById("busy").classList.remove("hidden");
    document.getElementById("ok").classList.add("hidden");
    document.getElementById("error").classList.add("hidden");
  } else {
    document.getElementById("busy").classList.add("hidden");
  }
}

window.addEventListener("beforeunload", event => {
  if (window.isBusy) {
    event.preventDefault();
  };
})

browser.commands.onCommand.addListener(function (command, tab) {
if (command === "saveclose-ios-editor") {
    save();
}
});

