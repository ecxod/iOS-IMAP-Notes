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
      //return false;
      return true;
    }

    // iOS device seem to introduce line breaks (\r\n) which lead to return null for htmlParts below so we remove them
    note.raw = note.raw.replace(/(\r\n|\n|\r)/gm, "");

    let lowerCaseNote = note.raw.toLowerCase();
    // Try to parse html message or fallback to text.
    if (lowerCaseNote.includes("<body") && lowerCaseNote.includes("</body>")) {
      let htmlParts = note.raw.match(/^(.*?)<body(.*?)>(.*?)<\/body>(.*)/);
      note.htmlPrefix = `${htmlParts[1]}<body${htmlParts[2]}>`;
      note.htmlSuffix = `</body>${htmlParts[4]}`;

      let innerContent = htmlParts[3];

      // Schritt 1: Den reinen Text vor dem ersten HTML-Tag extrahieren → das ist der "Titel im Body"
      // Apple schreibt den Subject immer nochmal als Plaintext vor dem ersten Tag
      let firstTagIndex = innerContent.search(/</);
      let titleInBody = "";
      if (firstTagIndex > 0) {
        titleInBody = innerContent.substring(0, firstTagIndex);
        innerContent = innerContent.substring(firstTagIndex);
      } else if (firstTagIndex === -1) {
        // Kein HTML-Tag → ganze Notiz ist nur Titel (sehr selten)
        titleInBody = innerContent;
        innerContent = "";
      }

      // Schritt 2: Den eigentlichen Inhalt (ab erstem Tag) übernehmen
      // Aber: Wir wollen nur den ersten Block-Container (div oder span), nicht den reinen Text davor (den haben wir schon)
      let contentMatch = innerContent.match(/^(\s*<(div|span)[^>]*>([\s\S]*))/i);
      if (contentMatch) {
        note.content = contentMatch[1]; // komplettes <div>...</div> oder <span>...</span>
      } else {
        // Fallback: kein div/span → leer oder nur Text
        note.content = innerContent.trim().length > 0 ? innerContent : "<div><br></div>";
      }

      // Falls keine titleInBody gefunden → aber Subject existiert → beim ersten Mal setzen
      if (!note.titleInBody && note.full.headers.subject) {
        note.titleInBody = note.full.headers.subject[0];
      }

      // WICHTIG: Wir merken uns den Titel im Body, falls vorhanden
      // (wird später beim Speichern wieder exakt so eingefügt)
      note.titleInBody = titleInBody.trim();

    } else {
      // Fallback für reine Text-Notes (sehr selten)
      note.htmlPrefix = "";
      note.htmlSuffix = "";
      note.content = note.raw;   // hier gab es früher auch das <div-Problem
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

  // === KORREKTER ZUSAMMENBAU (Apple-kompatibel) ===
  let editorContent = window.editor.getContents();

  // SunEditor → <p> in <div> umwandeln
  editorContent = editorContent
    .replace(/<p>/gi, '<div>')
    .replace(/<\/p>/gi, '</div>');

  // Falls der Editor leer ist → minimalen Inhalt sicherstellen
  if (editorContent.trim() === "" || editorContent.trim() === "<div><br></div>") {
    editorContent = "<div><br></div>";
  }

  // WICHTIG: Der lose Titel im Body MUSS immer exakt dem aktuellen Subject entsprechen!
  // Apple synchronisiert das nicht automatisch – wenn sie unterschiedlich sind, bleibt der alte Titel stehen!
  let titlePrefix = newSubject + "\n    "; // immer den neuen Betreff nehmen – das ist der heilige Gral!

  // Endgültiger Body-Inhalt
  let bodyContent = titlePrefix + editorContent;

  // Falls irgendwie kein Block-Element am Anfang steht (sollte nicht passieren)
  if (!/^[\s\r\n]*</.test(editorContent)) {
    bodyContent = titlePrefix + "<div>" + editorContent + "</div>";
  }

  // Zusammenbauen
  noteContent = window.note.htmlPrefix + bodyContent + window.note.htmlSuffix;

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
  // === WICHTIG: Neue UUID und Message-ID generieren, um Kollision zu vermeiden ===
  const newUUID = crypto.randomUUID();
  const newMessageId = `<${newUUID}@${origNoteMsgHeader.author?.split('@')[1] || 'localhost'}>`;

  // Message-ID und UUID im Roh-Header ersetzen
  let newNoteRaw = utf8NewNote
    .replace(/^Message-Id:.*$/mi, `Message-Id: ${newMessageId}`)
    .replace(/^X-Universally-Unique-Identifier:.*$/mi, `X-Universally-Unique-Identifier: ${newUUID.toUpperCase()}`);

  let newMsgFile = new File([newNoteRaw], `${newUUID}.eml`, { type: 'message/rfc822' });

  // === Lokales Konto und Trash-Ordner finden – angepasst für TB 128+ ===
  let localAccount = (await messenger.accounts.list(false))
    .find(account => account.type == "none");

  if (!localAccount?.rootFolder?.id) {
    console.error("Kein lokales Konto mit rootFolder gefunden");
    return false;
  }

  // getSubFolders braucht jetzt die ID des Root-Folders (nicht mehr das Account-Objekt)
  let localFolders = await messenger.folders.getSubFolders(localAccount.rootFolder.id, false);

  let trashFolder = localFolders.find(folder => folder.type == "trash");
  if (!trashFolder) {
    trashFolder = localFolders.find(folder => folder.name == "Trash");
  }
  if (!trashFolder) {
    // create gibt die neue Folder-ID zurück → aber wir brauchen das Folder-Objekt
    const newTrashId = await messenger.folders.create(localAccount.id, "Trash");
    trashFolder = await messenger.folders.get(newTrashId);
  }

  if (!trashFolder?.id) {
    console.error("Trash-Ordner konnte nicht gefunden oder erstellt werden");
    return false;
  }

  // === Import mit .id statt ganzem Folder-Objekt ===
  let newNoteHeader;
  try {
    newNoteHeader = await messenger.messages.import(newMsgFile, trashFolder.id, {
      flagged: origNoteMsgHeader.flagged,
      read: origNoteMsgHeader.read,
      tags: origNoteMsgHeader.tags
    });
  } catch (ex) {
    console.error("Import fehlgeschlagen:", ex);
    return false;
  }

  if (!newNoteHeader) {
    console.error("messages.import gab null zurück");
    return false;
  }

  console.log("Created [" + origNoteMsgHeader.id + " → " + newNoteHeader.id + "]");

  // Der Rest (Verschieben + Original löschen/backup) bleibt exakt gleich wie vorher
  let newMovedMsgHeader;
  try {
    let waitCounter = 0;
    newMovedMsgHeader = await new Promise((resolve, reject) => {
      let checkFolder = async () => {
        let page = await browser.messages.query({
          folderId: origNoteMsgHeader.folder.id,          // ← .id statt folder: …
          headerMessageId: newNoteHeader.headerMessageId
        });
        do {
          let { messages } = page;
          let movedMessage = messages.find(m =>
            m.headerMessageId == newNoteHeader.headerMessageId &&
            m.id != origNoteMsgHeader.id
          );
          if (movedMessage) {
            console.log("Moved [" + newNoteHeader.id + " → " + movedMessage.id + "]");
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
      };
      messenger.messages.move([newNoteHeader.id], origNoteMsgHeader.folder.id);
      checkFolder();
    });
  } catch (ex) {
    console.error(ex);
  }

  if (!newMovedMsgHeader) {
    return false;
  }

  // Remove or backup original note.
  if (keepBackup) {
    await messenger.messages.move([origNoteMsgHeader.id], trashFolder.id);
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

