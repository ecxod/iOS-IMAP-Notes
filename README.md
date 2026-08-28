# iOS IMAP Notes

This project provides two editors for Apple Notes stored as IMAP messages:

- a Thunderbird extension that edits a note directly in Thunderbird's Message Pane;
- an optional Electron desktop application with a local cache and multi-account
  IMAP synchronization.

## Thunderbird extension

The extension recognizes Apple Notes by their
`X-Uniform-Type-Identifier: com.apple.mail-note` header.

When an Apple Note is displayed, **Edit note** in the Message Header Toolbar
enables editing directly inside the Message Body. During editing, the same
action becomes **Save note**. The usual email actions in that toolbar are
disabled for Apple Notes, except **Delete** and **More**, and a **New note**
button is added. For ordinary email messages, Thunderbird's normal actions are
enabled again and **Edit note** remains visible but disabled.

Selecting an Apple Note enters edit mode locally. Nothing is written back to
IMAP until **Save note** is explicitly activated.

Before saving, the extension compares the current message with the revision
opened in the editor and checks for a newer message with the same Apple Note
UUID. A concurrent change aborts the save instead of overwriting the other copy.

This conditional toolbar customization uses a narrowly scoped Experiment API.
Thunderbird therefore describes the add-on permission as full access during
installation; the Experiment only changes the Message Header Toolbar UI.

A new Apple Note can be created in the currently selected writable folder by:

- choosing **New note** from the folder-pane or message-list context menu;
- pressing `Ctrl+Alt+N`.

Additional shortcuts:

- `Ctrl+Q`: edit the displayed Apple Note;
- `Alt+Q`: save the note;
- `Ctrl+S`: save while the Message Body editor has focus;
- `Escape`: cancel the current edit.

Saving creates a replacement IMAP message while preserving the Apple Note UUID.
By default, the previous message is moved to the Local Folders Trash as a backup.

### Build and test the XPI

Requirements: Node.js and `zip`.

```sh
npm test
npm run check
npm run build:xpi
```

The resulting extension is written to
`dist/thunderbird-ios-imap-notes-<version>.xpi`. The XPI intentionally excludes
the Electron application and SunEditor.

## Desktop editor

The optional application in `desktop/` uses the former SunEditor interface. It
supports any number of IMAP accounts. **Settings** stores an account name, IMAP
host, port, TLS mode, username and Notes folder for each account. On Windows,
passwords are encrypted for the signed-in user with DPAPI through Electron's
`safeStorage`; passwords are never written to the notes cache.

**Sync** reads Apple Notes from all enabled accounts into one mixed, locally
cached list. Search covers note titles, bodies and account names across that
complete list. It ignores spaces, line breaks and common separators such as
hyphens and slashes, and highlights matches in list titles and the open note.
The account filter can narrow the list without changing a note's storage
location. Local-only notes remain supported, as do importing `.html`,
`.htm` and `.txt` files and exporting notes as HTML.

**Paste plain text** or `Ctrl+Shift+V` inserts only the clipboard's text and
line breaks. Normal `Ctrl+V` remains available when copied HTML formatting
should be preserved.

Every synchronized note records its source account, folder, IMAP UIDVALIDITY,
UID, Apple UUID and source revision. Saving always appends the replacement to
that same account and folder, then removes the previous message. If the server
copy changed since synchronization, saving is stopped instead of overwriting
it. The local cache keeps synchronized notes readable while disconnected; an
IMAP note must be online to save or delete it.

```sh
cd desktop
npm ci
npm run check
npm test
npm start
```

`npm run dist:win` builds a 64-bit NSIS installer. The GitHub Actions workflow
also produces the installable Windows `.exe` and attaches it to tagged releases.
The installed app checks those releases on startup and shows its current version
and update state at the bottom of the Notes list. New versions are downloaded and
installed only after the user clicks the displayed update buttons. Every desktop
release must include the generated `.exe`, `.exe.blockmap` and `latest.yml` files.

## Compatibility

Version 1.4.0 targets Thunderbird 128 through 154. Because the Message Header
Toolbar integration uses a MailExtension Experiment, each new Thunderbird major
version must be verified before its compatibility limit is raised. Older
releases remain available for Thunderbird 115 and earlier extension behavior.

## Contributors

- Paolo "Kaosmos"
- Klaus "Opto" Bücher
- [JesseLujack](https://addons.thunderbird.net/user/JesseLujack/)
- [John Bieling](https://github.com/jobisoft)
- [Christian Eichert](https://github.com/ecxod)

## Credits

Success and failure icons: [icons8.com](https://icons8.com/).

## License

[GPL v3](LICENSE)
