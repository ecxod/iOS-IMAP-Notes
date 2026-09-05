# iOS IMAP Notes

This project provides three clients for Apple Notes stored as IMAP messages:

- a Thunderbird extension that edits a note directly in Thunderbird's Message Pane;
- an optional Electron desktop application with a local cache and multi-account
  IMAP synchronization;
- a native Android application for Android 6.0 and newer.

## Android application

The native Android client is in `android/`. It connects directly to an IMAP
server over certificate-validated TLS, stores the password encrypted by the
Android Keystore and keeps a local SQLite cache so synchronized notes remain
readable offline. It supports multiple IMAP accounts, mailbox discovery,
selectable automatic, CRAM-MD5, PLAIN or LOGIN authentication, note search,
creation, editing with SunEditor, selectable spell-check language, deletion and
manual synchronization. JPEG, PNG, GIF and WebP images can be inserted directly
in the editor and are synchronized as Apple-compatible inline MIME parts.

The **Propr.** screen manages the IMAP accounts and checks GitHub Releases for
new Android versions. An update is accepted only when its package name and
release-certificate SHA-256 fingerprint match the installed application;
Android still displays its normal installation approval. Release APK assets
must be named `ios-imap-notes-android-<version>.apk`.

Saving uses the same Apple headers and UUID as the Thunderbird and desktop
editors. It verifies IMAP UIDVALIDITY, UID and the raw source revision before it
appends a replacement. Only after the replacement has been found on the server
does it expunge exactly the previous message. Notes containing unsupported
attachments or unknown MIME parts are displayed read-only to avoid losing
content. Inline JPEG, PNG, GIF and WebP parts referenced by Apple's Content-ID
attachment objects remain editable and available offline.

One universal APK supports API 23 (Android 6.0) through current Android
versions. The project compiles and targets API 36. Build it with:

```sh
cd android
./gradlew clean test lintRelease assembleRelease
```

Release signing is configured only through the environment variables
`IOS_NOTES_ANDROID_KEYSTORE_PATH`, `IOS_NOTES_ANDROID_KEYSTORE_PASSWORD`,
`IOS_NOTES_ANDROID_KEY_ALIAS` and `IOS_NOTES_ANDROID_KEY_PASSWORD`; credentials
must not be committed to the repository.

## Thunderbird extension

The extension recognizes Apple Notes by their
`X-Uniform-Type-Identifier: com.apple.mail-note` header.

### Standard and Header Controls editions

Two Thunderbird XPI editions are published from the same source and share the
same add-on ID. Install only one edition at a time:

| Edition | File | Distribution | Native email actions in note mode |
| --- | --- | --- | --- |
| Standard | `thunderbird-ios-imap-notes-<version>.xpi` | GitHub and [Thunderbird Add-ons](https://addons.thunderbird.net/thunderbird/addon/ios-imap-notes/) | Remain visible and enabled |
| Header Controls | `thunderbird-ios-imap-notes-<version>-header-controls.xpi` | [GitHub Releases](https://github.com/ecxod/iOS-IMAP-Notes/releases) | Reply, Forward, Archive, Junk and Star are disabled |

The Standard edition uses only built-in Thunderbird MailExtension APIs. It is
the edition submitted to addons.thunderbird.net. Its inline editor, Apple Note
creation, conflict protection, MIME handling, context menus and keyboard
shortcuts do not require an Experiment API.

The Header Controls edition additionally uses the narrowly scoped
`notesHeader` Experiment to distinguish notes from ordinary email in
Thunderbird's native Message Header Toolbar. It adds a **New note** button and
disables inappropriate email actions while a verified Apple Note is displayed;
the normal controls are restored immediately for ordinary email.

The Thunderbird Add-ons team is phasing out support for Experiment APIs and
does not accept new submissions that add Experiment surface to an existing
add-on. The Header Controls edition is therefore not accepted for distribution
on addons.thunderbird.net and is offered on GitHub instead. This restriction is
a store distribution policy; it is not caused by a known defect in the editor,
Apple synchronization or the `notesHeader` implementation.

Updates stay on their respective distribution channels. The Standard edition
contains no custom update URL and is updated by Thunderbird through
addons.thunderbird.net. The Header Controls edition uses Thunderbird's built-in
extension updater with the HTTPS manifest at
`updates/header-controls.json`, which points only to Header Controls XPIs on
this project's GitHub Releases page and verifies the selected XPI with SHA-256.
There is no custom updater code and no note, message or account data is sent
during the version check.

When an Apple Note is displayed, **Edit note** in the Message Header Toolbar
enables editing directly inside the Message Body. During editing, the same
action becomes **Save note**. In the Header Controls edition, the usual email
actions in that toolbar are disabled for Apple Notes, except **Delete** and
**More**, and a **New note** button is added. The Standard edition deliberately
leaves Thunderbird's native email actions unchanged.

The **Refresh notes** button in Thunderbird's unified mail toolbar requests an
immediate update of the displayed IMAP folder. Finish or cancel an open note
edit before refreshing so that Thunderbird never replaces unsaved editor
content by changing the displayed message.

Selecting an Apple Note enters edit mode locally. Nothing is written back to
IMAP until **Save note** is explicitly activated.

Before saving, the extension compares the current message with the revision
opened in the editor and checks for a newer message with the same Apple Note
UUID. A concurrent change aborts the save instead of overwriting the other copy.

Only the Header Controls edition requests full, unrestricted Thunderbird access
during installation. Its Experiment changes the Message Header Toolbar UI and
does not participate in parsing, editing or saving Apple Notes.

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

Apple stores attachments in IMAP notes as `multipart/related` messages. The HTML
contains `application/x-apple-msg-attachment` objects that reference inline MIME
parts by Content-ID. The Thunderbird extension renders supported images inline
but keeps attachment-bearing notes read-only. A reviewable compatibility test
note can be generated without changing a mailbox:

```sh
node scripts/create-attachment-note.mjs \
  --title "Anhangstest" \
  --output /tmp/apple-attachment-test.eml \
  image.jpg
```

Import the generated `.eml` unchanged into the IMAP Notes folder to test it on
an Apple device.

Thunderbird 128 and newer resolves those Content-IDs through its attachment API
and displays supported image parts in the note body as well as in Thunderbird's
normal attachment list. The original MIME message is not modified.

### Build and test the XPI

Requirements: Node.js and `zip`.

```sh
npm test
npm run check
npm run build:xpi
npm run build:xpi:header-controls
```

The resulting extensions are written to
`dist/thunderbird-ios-imap-notes-<version>.xpi` and
`dist/thunderbird-ios-imap-notes-<version>-header-controls.xpi`. Both XPIs
intentionally exclude the Electron application and SunEditor. The Standard XPI
also excludes the Experiment schema and implementation and contains no call to
`browser.notesHeader`.

## Desktop editor

The optional application in `desktop/` uses the former SunEditor interface. It
supports any number of IMAP accounts. **Settings** stores an account name, IMAP
host, port, TLS mode, username and Notes folder for each account. It also accepts
API keys for ChatGPT/OpenAI and Gemini for future AI features. On Windows,
passwords and API keys are encrypted for the signed-in user with DPAPI through
Electron's `safeStorage`; credentials are never written to the notes cache or
returned in plaintext to the renderer.

The Electron application can import public ChatGPT and Gemini share links from
**Settings**. Only the prompts and answers become note content; provider titles,
model names, timestamps and other page information are ignored. A title for a
new note is derived once from its first prompt and is never replaced during an
update. Imported conversations keep a private Git history in Electron's local
application-data directory. When a later share link is recognized as a clean
continuation, new prompt/answer blocks are appended while local edits stay in
place. Ambiguous or conflicting changes are never applied silently. This import
feature is intentionally not included in either Thunderbird extension.

Opened notes remain available in separate, closeable editor tabs, including
unsaved changes while another tab is active. Selecting an account on the left
opens an account-bound empty tab when the current tab belongs to another
account; empty tabs cannot be created manually and are reused when a note from
that account is opened. When an account is added, selected or synchronized, the
configured Notes folder is created automatically if it is missing.

JPEG, PNG, GIF and WebP images can be inserted with SunEditor's image button.
Existing Apple Notes images are displayed inline and saved with their original
Content-ID; unsupported attachments keep a synchronized note read-only.
The note list transfers only compact summaries to the renderer, unchanged IMAP
messages are reused from the cache, and MIME parsing runs outside Electron's
main thread. **Close** closes the desktop application directly after confirming
the loss of any unsaved edit.

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

Version 1.4.7 targets Thunderbird 128 and newer. The Standard edition uses only
built-in MailExtension APIs and has no Experiment-specific maximum version. The
Header Controls edition is limited to Thunderbird 154 because its native Message
Header Toolbar integration must be verified for each new Thunderbird major
version. Older releases remain available for Thunderbird 115 and earlier
extension behavior.

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
