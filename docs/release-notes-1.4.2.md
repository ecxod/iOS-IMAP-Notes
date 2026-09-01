# iOS IMAP Notes 1.4.2

Version 1.4.2 introduces two Thunderbird packages built from the same source:

- `thunderbird-ios-imap-notes-1.4.2.xpi` is the Standard edition for
  addons.thunderbird.net. It uses only built-in Thunderbird MailExtension APIs.
- `thunderbird-ios-imap-notes-1.4.2-header-controls.xpi` is the GitHub-only
  edition. It additionally disables Reply, Forward, Archive, Junk and Star for
  Apple Notes and adds a native **New note** button.

Install only one XPI edition at a time. Both retain the inline Apple Notes
editor, conflict protection, note creation, MIME handling, context menus and
keyboard shortcuts.

This release also includes the current desktop editor improvements for notes
with inline images and attachments, background MIME parsing and an emergency
window-close path for image-heavy notes.

The Standard edition was created in response to Thunderbird Add-ons review:
support for Experiment APIs is being phased out, so new Experiment surface is
not accepted for an existing add-on. The optional Header Controls edition is
therefore distributed on GitHub rather than submitted to the add-on store.
