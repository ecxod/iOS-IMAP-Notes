# Reviewer notes for version 1.4.2

The file submitted to addons.thunderbird.net is:

`dist/thunderbird-ios-imap-notes-1.4.2.xpi`

This is the **Standard** edition. It contains no `experiment_apis` manifest
entry, no `experiments/` directory and no call to `browser.notesHeader`. The
separate `-header-controls.xpi` file published on GitHub is not submitted to
addons.thunderbird.net.

## Why there are two editions

Earlier versions used the local `notesHeader` Experiment only to add a **New
note** button to Thunderbird's native Message Header Toolbar and to disable
Reply, Forward, Archive, Junk and Star while an Apple Note was displayed. The
editor and IMAP synchronization do not depend on that Experiment.

Following reviewer guidance that new Experiment surface is no longer accepted,
version 1.4.2 makes the Standard edition exclusively with Thunderbird's built-in
MailExtension APIs. The optional Header Controls edition remains available from
GitHub for users who deliberately install it outside the add-on store.

## Built-in APIs used

- `messageDisplayAction` provides the **Edit note** / **Save note** action.
- `scripting.messageDisplay` injects the editor into the displayed message.
- `messages`, `folders` and `mailTabs` read, create and replace the IMAP message
  that represents an Apple Note.
- `menus`, `commands`, `storage` and `notifications` provide the documented
  user-interface and preference features.

The add-on identifies an Apple Note using the
`X-Uniform-Type-Identifier: com.apple.mail-note` message header. Saving creates
a replacement RFC 822 message with Apple Notes headers and MIME content, then
deletes the superseded message. It does not alter arbitrary email messages.

There is no remote executable code and the extension does not transmit note
content to a third-party service. Network access is performed by Thunderbird's
own account and IMAP implementation.

## Reproducible checks

From the repository root:

```sh
npm test
npm run check
npm run build:xpi
unzip -t dist/thunderbird-ios-imap-notes-1.4.2.xpi
unzip -p dist/thunderbird-ios-imap-notes-1.4.2.xpi manifest.json
unzip -Z1 dist/thunderbird-ios-imap-notes-1.4.2.xpi | grep '^experiments/'
```

The final `grep` intentionally produces no output and exits with status 1.

## Manual test outline

1. Open an IMAP message with the Apple Note identification header.
2. Select **Edit note**, change the body and select **Save note**.
3. Confirm that the replacement note synchronizes to Apple Notes.
4. Open an ordinary email and confirm that editing remains unavailable.
5. Create a note with the extension command or context menu and confirm that it
   appears in the selected writable IMAP folder.
