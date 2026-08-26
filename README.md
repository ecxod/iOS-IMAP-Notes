# iOS IMAP Notes

This project provides two editors for Apple Notes stored as IMAP messages:

- a Thunderbird extension that edits a note directly in Thunderbird's Message Pane;
- an optional Electron desktop application for local, offline notes.

## Thunderbird extension

The extension recognizes Apple Notes by their
`X-Uniform-Type-Identifier: com.apple.mail-note` header.

When an Apple Note is displayed, **Edit note** in the Message Header Toolbar
enables editing directly inside the Message Body. During editing, the same
action becomes **Save note**. For ordinary email messages, the button remains
visible but disabled.

A new Apple Note can be created in the currently selected writable folder by:

- choosing **New Apple note** from the folder-pane or message-list context menu;
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

## Offline desktop editor

The optional application in `desktop/` uses the former SunEditor interface. It
stores a private JSON notes library in Electron's per-user application-data
directory and supports importing `.html`, `.htm`, and `.txt` files and exporting
notes as HTML.

It is deliberately an offline local editor: it does not connect to Thunderbird
or synchronize an IMAP mailbox.

```sh
cd desktop
npm ci
npm run check
npm start
```

`npm run dist:win` builds a 64-bit NSIS installer. The GitHub Actions workflow
also produces the installable Windows `.exe` and attaches it to tagged releases.

## Compatibility

Version 1.1.0 targets Thunderbird 128 and later. Older releases remain available
for Thunderbird 115 and earlier extension behavior.

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
