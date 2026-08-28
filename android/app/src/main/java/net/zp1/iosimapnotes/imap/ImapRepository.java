package net.zp1.iosimapnotes.imap;

import com.sun.mail.imap.IMAPFolder;

import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Properties;

import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.UIDFolder;
import javax.mail.internet.MimeMessage;
import javax.mail.search.HeaderTerm;
import javax.mail.search.MessageIDTerm;

public final class ImapRepository {
    private static final int TIMEOUT_MS = 20_000;

    public List<String> listFolders(Account account, String password) throws Exception {
        try (Connection connection = connect(account, password)) {
            Folder[] folders = connection.store.getDefaultFolder().list("*");
            List<String> result = new ArrayList<>();
            for (Folder folder : folders) {
                if ((folder.getType() & Folder.HOLDS_MESSAGES) != 0) {
                    result.add(folder.getFullName());
                }
            }
            Collections.sort(result, String.CASE_INSENSITIVE_ORDER);
            return result;
        }
    }

    public List<Note> synchronize(Account account, String password) throws Exception {
        try (Connection connection = connect(account, password)) {
            Folder folder = openFolder(connection.store, account.mailbox, Folder.READ_ONLY);
            try {
                UIDFolder uidFolder = requireUidFolder(folder);
                long uidValidity = uidFolder.getUIDValidity();
                Message[] messages = findAppleNotes(folder);
                Arrays.sort(messages, new Comparator<Message>() {
                    @Override
                    public int compare(Message left, Message right) {
                        return Integer.compare(left.getMessageNumber(), right.getMessageNumber());
                    }
                });
                List<Note> result = new ArrayList<>();
                for (Message message : messages) {
                    byte[] source = AppleNoteCodec.toSource(message);
                    Note note = AppleNoteCodec.parse(
                            source,
                            account.id,
                            account.mailbox,
                            uidFolder.getUID(message),
                            uidValidity,
                            message.getReceivedDate(),
                            account.username
                    );
                    if (note != null) {
                        result.add(note);
                    }
                }
                return result;
            } finally {
                closeFolder(folder, false);
            }
        }
    }

    public Note create(Account account, String password, String title, String bodyHtml) throws Exception {
        try (Connection connection = connect(account, password)) {
            Folder folder = openFolder(connection.store, account.mailbox, Folder.READ_WRITE);
            try {
                MimeMessage message = AppleNoteCodec.build(
                        connection.session, title, bodyHtml, account.username, "", ""
                );
                Message remote = appendAndResolve(folder, message);
                return parseRemote(account, folder, remote);
            } finally {
                closeFolder(folder, false);
            }
        }
    }

    public SaveResult save(Account account, String password, Note note) throws Exception {
        if (note.readOnly) {
            throw new IllegalStateException("Diese Notiz ist schreibgeschützt.");
        }
        try (Connection connection = connect(account, password)) {
            Folder folder = openFolder(connection.store, note.mailbox, Folder.READ_WRITE);
            try {
                Message current = verifyCurrent(folder, note);
                MimeMessage replacement = AppleNoteCodec.build(
                        connection.session,
                        note.title,
                        note.bodyHtml,
                        note.fromAddress.isEmpty() ? account.username : note.fromAddress,
                        note.createdDate,
                        note.uuid
                );
                Message remote = appendAndResolve(folder, replacement);
                Note saved = parseRemote(account, folder, remote);
                String warning = deleteExact(folder, current)
                        ? ""
                        : "Die neue Fassung wurde gespeichert, aber die alte IMAP-Kopie konnte nicht entfernt werden. Bitte synchronisieren.";
                return new SaveResult(saved, warning);
            } finally {
                closeFolder(folder, false);
            }
        }
    }

    public void delete(Account account, String password, Note note) throws Exception {
        try (Connection connection = connect(account, password)) {
            Folder folder = openFolder(connection.store, note.mailbox, Folder.READ_WRITE);
            try {
                Message current = verifyCurrent(folder, note);
                if (!deleteExact(folder, current)) {
                    throw new MessagingException("Der IMAP-Server konnte die Notiz nicht endgültig löschen.");
                }
            } finally {
                closeFolder(folder, false);
            }
        }
    }

    private static Connection connect(Account account, String password) throws Exception {
        if (account == null) {
            throw new IllegalArgumentException("Es ist kein IMAP-Konto eingerichtet.");
        }
        if (password == null || password.isEmpty()) {
            throw new IllegalArgumentException("Das IMAP-Passwort fehlt.");
        }
        Properties properties = new Properties();
        properties.setProperty("mail.store.protocol", account.usesStartTls() ? "imap" : "imaps");
        properties.setProperty("mail.imap.connectiontimeout", String.valueOf(TIMEOUT_MS));
        properties.setProperty("mail.imap.timeout", String.valueOf(TIMEOUT_MS));
        properties.setProperty("mail.imap.writetimeout", String.valueOf(TIMEOUT_MS));
        properties.setProperty("mail.imaps.connectiontimeout", String.valueOf(TIMEOUT_MS));
        properties.setProperty("mail.imaps.timeout", String.valueOf(TIMEOUT_MS));
        properties.setProperty("mail.imaps.writetimeout", String.valueOf(TIMEOUT_MS));
        properties.setProperty("mail.imap.ssl.checkserveridentity", "true");
        properties.setProperty("mail.imaps.ssl.checkserveridentity", "true");
        if (account.usesStartTls()) {
            properties.setProperty("mail.imap.starttls.enable", "true");
            properties.setProperty("mail.imap.starttls.required", "true");
            properties.setProperty("mail.imap.ssl.enable", "false");
        } else {
            properties.setProperty("mail.imaps.ssl.enable", "true");
        }

        String protocol = account.usesStartTls() ? "imap" : "imaps";
        if (Account.AUTH_CRAM_MD5.equals(account.authentication)) {
            properties.setProperty("mail." + protocol + ".sasl.enable", "true");
            properties.setProperty("mail." + protocol + ".sasl.mechanisms", "CRAM-MD5");
        } else if (Account.AUTH_PLAIN.equals(account.authentication)) {
            properties.setProperty("mail." + protocol + ".auth.mechanisms", "PLAIN");
        } else if (Account.AUTH_LOGIN.equals(account.authentication)) {
            properties.setProperty("mail." + protocol + ".auth.mechanisms", "LOGIN");
        }

        Session session = Session.getInstance(properties);
        Store store = session.getStore(account.usesStartTls() ? "imap" : "imaps");
        try {
            store.connect(account.host, account.port, account.username, password);
            return new Connection(session, store);
        } catch (Exception error) {
            try {
                store.close();
            } catch (Exception ignored) {
                // The original connection error is more useful.
            }
            throw error;
        }
    }

    private static Folder openFolder(Store store, String name, int mode) throws Exception {
        Folder folder = store.getFolder(name);
        if (folder == null || !folder.exists()) {
            throw new MessagingException("Der IMAP-Ordner „" + name + "“ wurde nicht gefunden.");
        }
        folder.open(mode);
        return folder;
    }

    private static UIDFolder requireUidFolder(Folder folder) throws MessagingException {
        if (!(folder instanceof UIDFolder)) {
            throw new MessagingException("Der IMAP-Server unterstützt keine stabilen UIDs.");
        }
        return (UIDFolder) folder;
    }

    private static Message[] findAppleNotes(Folder folder) throws Exception {
        try {
            return folder.search(new HeaderTerm(
                    "X-Uniform-Type-Identifier", AppleNoteCodec.APPLE_NOTE_UTI
            ));
        } catch (MessagingException searchError) {
            List<Message> result = new ArrayList<>();
            for (Message message : folder.getMessages()) {
                String[] values = message.getHeader("X-Uniform-Type-Identifier");
                if (values != null) {
                    for (String value : values) {
                        if (AppleNoteCodec.APPLE_NOTE_UTI.equalsIgnoreCase(value.trim())) {
                            result.add(message);
                            break;
                        }
                    }
                }
            }
            return result.toArray(new Message[0]);
        }
    }

    private static Message verifyCurrent(Folder folder, Note note) throws Exception {
        UIDFolder uidFolder = requireUidFolder(folder);
        if (uidFolder.getUIDValidity() != note.uidValidity) {
            throw new ConflictException();
        }
        Message current = uidFolder.getMessageByUID(note.uid);
        if (current == null || current.isExpunged()) {
            throw new ConflictException();
        }
        String currentRevision = AppleNoteCodec.sourceRevision(AppleNoteCodec.toSource(current));
        if (!currentRevision.equals(note.revision)) {
            throw new ConflictException();
        }
        if (!note.uuid.isEmpty()) {
            Message[] sameUuid = folder.search(new HeaderTerm(
                    "X-Universally-Unique-Identifier", note.uuid
            ));
            for (Message candidate : sameUuid) {
                long candidateUid = uidFolder.getUID(candidate);
                if (candidateUid > note.uid) {
                    throw new ConflictException();
                }
            }
        }
        return current;
    }

    private static Message appendAndResolve(Folder folder, MimeMessage message) throws Exception {
        String messageId = message.getMessageID();
        folder.appendMessages(new Message[]{message});
        for (int attempt = 0; attempt < 5; attempt++) {
            Message[] matches = folder.search(new MessageIDTerm(messageId));
            if (matches.length > 0) {
                return matches[matches.length - 1];
            }
            if (attempt < 4) {
                Thread.sleep(250L);
            }
        }
        throw new MessagingException(
                "Die Notiz wurde hochgeladen, ihre neue IMAP-UID konnte aber nicht ermittelt werden. Bitte synchronisieren."
        );
    }

    private static Note parseRemote(Account account, Folder folder, Message message) throws Exception {
        UIDFolder uidFolder = requireUidFolder(folder);
        Note note = AppleNoteCodec.parse(
                AppleNoteCodec.toSource(message),
                account.id,
                folder.getFullName(),
                uidFolder.getUID(message),
                uidFolder.getUIDValidity(),
                message.getReceivedDate() != null ? message.getReceivedDate() : new Date(),
                account.username
        );
        if (note == null) {
            throw new MessagingException("Der Server hat keine lesbare Apple-Notiz gespeichert.");
        }
        return note;
    }

    private static boolean deleteExact(Folder folder, Message message) throws Exception {
        if (!(folder instanceof IMAPFolder)) {
            return false;
        }
        message.setFlag(Flags.Flag.DELETED, true);
        Message[] expunged = ((IMAPFolder) folder).expunge(new Message[]{message});
        return expunged != null && expunged.length == 1;
    }

    private static void closeFolder(Folder folder, boolean expunge) {
        if (folder == null || !folder.isOpen()) {
            return;
        }
        try {
            folder.close(expunge);
        } catch (Exception ignored) {
            // Connection.close() will still close the store.
        }
    }

    public static final class SaveResult {
        public final Note note;
        public final String warning;

        SaveResult(Note note, String warning) {
            this.note = note;
            this.warning = warning;
        }
    }

    public static final class ConflictException extends Exception {
        public ConflictException() {
            super("Diese Notiz wurde auf dem IMAP-Server geändert. Bitte synchronisieren und die aktuelle Fassung erneut öffnen.");
        }
    }

    private static final class Connection implements AutoCloseable {
        final Session session;
        final Store store;

        Connection(Session session, Store store) {
            this.session = session;
            this.store = store;
        }

        @Override
        public void close() {
            try {
                if (store.isConnected()) {
                    store.close();
                }
            } catch (Exception ignored) {
                // No action is possible while unwinding a connection.
            }
        }
    }
}
