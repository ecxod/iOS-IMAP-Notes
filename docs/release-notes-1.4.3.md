# iOS IMAP Notes 1.4.3

Version 1.4.3 keeps the two Thunderbird editions on separate automatic update
channels:

- `thunderbird-ios-imap-notes-1.4.3.xpi` is the Standard edition for
  addons.thunderbird.net. It contains no Experiment and no custom update URL;
  Thunderbird obtains its updates from the add-on store.
- `thunderbird-ios-imap-notes-1.4.3-header-controls.xpi` is the GitHub-only
  edition. Thunderbird's built-in extension updater checks this repository's
  HTTPS update manifest and installs only newer Header Controls packages from
  GitHub Releases. The manifest pins the exact XPI with SHA-256.

No custom updater or tracking code was added. The GitHub check downloads only a
small static JSON manifest and never transmits note, message or account data.

Install only one XPI edition at a time. Both retain the inline Apple Notes
editor, conflict protection, note creation, MIME handling, context menus and
keyboard shortcuts. The Header Controls edition additionally disables Reply,
Forward, Archive, Junk and Star for Apple Notes and adds a native **New note**
button.
