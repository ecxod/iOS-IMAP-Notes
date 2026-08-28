package net.zp1.iosimapnotes.imap;

import net.zp1.iosimapnotes.model.Note;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Properties;
import java.util.TimeZone;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.mail.Address;
import javax.mail.BodyPart;
import javax.mail.Message;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

public final class AppleNoteCodec {
    public static final String APPLE_NOTE_UTI = "com.apple.mail-note";
    public static final int MAX_TITLE_LENGTH = 500;
    public static final int MAX_BODY_LENGTH = 10 * 1024 * 1024;

    private static final Pattern BODY = Pattern.compile(
            "<body\\b[^>]*>([\\s\\S]*?)</body\\s*>",
            Pattern.CASE_INSENSITIVE
    );

    private AppleNoteCodec() {
    }

    public static MimeMessage parseMessage(byte[] source) throws Exception {
        return new MimeMessage(
                Session.getInstance(new Properties()),
                new ByteArrayInputStream(source)
        );
    }

    public static Note parse(
            byte[] source,
            long accountId,
            String mailbox,
            long uid,
            long uidValidity,
            Date internalDate,
            String fallbackFrom
    ) throws Exception {
        MimeMessage message = parseMessage(source);
        String uti = firstHeader(message, "X-Uniform-Type-Identifier");
        if (!APPLE_NOTE_UTI.equalsIgnoreCase(uti.trim())) {
            return null;
        }

        BodyResult body = readBody(message);
        if (body.html == null && body.plain == null) {
            return null;
        }
        String bodyHtml = body.html != null
                ? extractBody(body.html)
                : plainTextToHtml(body.plain);
        if (bodyHtml.length() > MAX_BODY_LENGTH) {
            bodyHtml = bodyHtml.substring(0, MAX_BODY_LENGTH);
            body.unsupported = true;
            body.reason = "Die Notiz ist größer als 10 MB und wird nur auszugsweise angezeigt.";
        }

        String uuid = firstHeader(message, "X-Universally-Unique-Identifier")
                .trim().toUpperCase(Locale.ROOT);
        Note note = new Note();
        note.accountId = accountId;
        note.mailbox = mailbox;
        note.uid = uid;
        note.uidValidity = uidValidity;
        note.uuid = uuid;
        note.id = noteId(accountId, mailbox, uuid, uidValidity, uid);
        note.title = cleanTitle(message.getSubject());
        note.bodyHtml = bodyHtml;
        Date changed = internalDate != null ? internalDate : message.getSentDate();
        note.updatedAt = changed != null ? changed.getTime() : System.currentTimeMillis();
        note.revision = sourceRevision(source);
        note.createdDate = firstHeader(message, "X-Mail-Created-Date");
        if (note.createdDate.isEmpty()) {
            note.createdDate = formatMailDate(message.getSentDate() != null
                    ? message.getSentDate() : new Date());
        }
        note.fromAddress = firstFrom(message, fallbackFrom);
        note.readOnly = body.unsupported;
        note.unsupportedReason = body.reason;
        return note;
    }

    public static MimeMessage build(
            Session session,
            String title,
            String bodyHtml,
            String from,
            String createdDate,
            String uuid
    ) throws Exception {
        MimeMessage message = new MimeMessage(session);
        Date now = new Date();
        String effectiveUuid = uuid == null || uuid.trim().isEmpty()
                ? UUID.randomUUID().toString().toUpperCase(Locale.ROOT)
                : uuid.trim().toUpperCase(Locale.ROOT);
        String effectiveFrom = from == null || from.trim().isEmpty()
                ? "notes@localhost" : from.trim();
        String safeBody = bodyHtml == null ? "<div><br></div>" : bodyHtml;
        if (safeBody.length() > MAX_BODY_LENGTH) {
            throw new IllegalArgumentException("Die Notiz darf höchstens 10 MB groß sein.");
        }

        message.setFrom(new InternetAddress(effectiveFrom));
        message.setSubject(cleanTitle(title), StandardCharsets.UTF_8.name());
        message.setSentDate(now);
        message.setHeader("X-Mail-Created-Date",
                createdDate == null || createdDate.trim().isEmpty()
                        ? formatMailDate(now) : createdDate.trim());
        message.setHeader("X-Uniform-Type-Identifier", APPLE_NOTE_UTI);
        message.setHeader("X-Universally-Unique-Identifier", effectiveUuid);
        message.setContent(
                "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>"
                        + safeBody + "</body></html>",
                "text/html; charset=UTF-8"
        );
        message.saveChanges();
        return message;
    }

    public static byte[] toSource(Message message) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        message.writeTo(output);
        return output.toByteArray();
    }

    public static String sourceRevision(byte[] source) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(source);
        StringBuilder result = new StringBuilder(hash.length * 2);
        for (byte value : hash) {
            result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        }
        return result.toString();
    }

    public static String cleanTitle(String value) {
        String title = value == null ? "" : value.trim();
        if (title.length() > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH);
        }
        return title.isEmpty() ? "Neue Notiz" : title;
    }

    static String extractBody(String html) {
        Matcher matcher = BODY.matcher(html == null ? "" : html);
        return matcher.find() ? matcher.group(1) : (html == null ? "" : html);
    }

    private static BodyResult readBody(Part part) throws Exception {
        BodyResult result = new BodyResult();
        readPart(part, result);
        return result;
    }

    private static void readPart(Part part, BodyResult result) throws Exception {
        String disposition = part.getDisposition();
        String fileName = part.getFileName();
        if (Part.ATTACHMENT.equalsIgnoreCase(disposition) || (fileName != null && !fileName.isEmpty())) {
            markUnsupported(result, "Anhänge, Zeichnungen oder Scans werden sicherheitshalber nur gelesen.");
            return;
        }
        if (part.isMimeType("text/html")) {
            Object content = part.getContent();
            if (content instanceof String && result.html == null) {
                result.html = (String) content;
            }
            return;
        }
        if (part.isMimeType("text/plain")) {
            Object content = part.getContent();
            if (content instanceof String && result.plain == null) {
                result.plain = (String) content;
            }
            return;
        }
        if (part.isMimeType("multipart/*")) {
            Object content = part.getContent();
            if (content instanceof Multipart) {
                Multipart multipart = (Multipart) content;
                for (int index = 0; index < multipart.getCount(); index++) {
                    BodyPart child = multipart.getBodyPart(index);
                    readPart(child, result);
                }
            }
            return;
        }
        if (!part.isMimeType("application/octet-stream")) {
            markUnsupported(result, "Dieser Notiztyp enthält nicht unterstützte Inhalte und ist schreibgeschützt.");
        } else {
            markUnsupported(result, "Anhänge werden sicherheitshalber nur gelesen.");
        }
    }

    private static void markUnsupported(BodyResult result, String reason) {
        result.unsupported = true;
        if (result.reason.isEmpty()) {
            result.reason = reason;
        }
    }

    private static String firstHeader(MimeMessage message, String name) throws Exception {
        String[] values = message.getHeader(name);
        return values == null || values.length == 0 || values[0] == null ? "" : values[0];
    }

    private static String firstFrom(MimeMessage message, String fallback) throws Exception {
        Address[] addresses = message.getFrom();
        if (addresses != null && addresses.length > 0) {
            if (addresses[0] instanceof InternetAddress) {
                String address = ((InternetAddress) addresses[0]).getAddress();
                if (address != null && !address.trim().isEmpty()) {
                    return address.trim();
                }
            }
            return addresses[0].toString();
        }
        return fallback == null ? "notes@localhost" : fallback;
    }

    private static String noteId(long accountId, String mailbox, String uuid, long uidValidity, long uid) {
        String stable = uuid.isEmpty() ? uidValidity + ":" + uid : uuid;
        try {
            return "imap:" + accountId + ":"
                    + URLEncoder.encode(mailbox, StandardCharsets.UTF_8.name()) + ":" + stable;
        } catch (Exception ignored) {
            return "imap:" + accountId + ":" + mailbox.hashCode() + ":" + stable;
        }
    }

    private static String plainTextToHtml(String value) {
        String escaped = (value == null ? "" : value)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\r\n", "\n")
                .replace("\r", "\n")
                .replace("\n", "<br>");
        return "<div>" + escaped + "</div>";
    }

    private static String formatMailDate(Date date) {
        SimpleDateFormat format = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(date == null ? new Date() : date);
    }

    private static final class BodyResult {
        String html;
        String plain;
        boolean unsupported;
        String reason = "";
    }
}
