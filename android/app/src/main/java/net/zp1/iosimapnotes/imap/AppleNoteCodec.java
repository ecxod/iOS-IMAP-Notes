package net.zp1.iosimapnotes.imap;

import net.zp1.iosimapnotes.model.Note;
import net.zp1.iosimapnotes.model.NoteImage;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.mail.Address;
import javax.mail.BodyPart;
import javax.activation.DataHandler;
import javax.mail.Message;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
import javax.mail.util.ByteArrayDataSource;

public final class AppleNoteCodec {
    public static final String APPLE_NOTE_UTI = "com.apple.mail-note";
    public static final int MAX_TITLE_LENGTH = 500;
    public static final int MAX_BODY_LENGTH = 10 * 1024 * 1024;
    public static final int MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024;
    private static final char[] BASE64 =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

    private static final Pattern BODY = Pattern.compile(
            "<body\\b[^>]*>([\\s\\S]*?)</body\\s*>",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern APPLE_ATTACHMENT_OBJECT = Pattern.compile(
            "<object\\b[^>]*>[\\s\\S]*?</object\\s*>",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern OBJECT_CONTENT_ID = Pattern.compile(
            "\\bdata\\s*=\\s*([\"'])cid:([^\"']+)\\1",
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
        Set<String> references = referencedContentIds(bodyHtml);
        for (String contentId : references) {
            if (!body.inlineImages.containsKey(contentId)) {
                markUnsupported(body, "Mindestens ein eingebettetes Bild fehlt oder ist beschädigt.");
            }
        }
        for (String contentId : body.inlineImages.keySet()) {
            if (!references.contains(contentId)) {
                markUnsupported(body, "Die Notiz enthält ein nicht zugeordnetes Bild und ist schreibgeschützt.");
            }
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
        note.images.addAll(body.inlineImages.values());
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
        return build(session, title, bodyHtml, from, createdDate, uuid, null);
    }

    public static MimeMessage build(
            Session session,
            String title,
            String bodyHtml,
            String from,
            String createdDate,
            String uuid,
            List<NoteImage> rawImages
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
        List<NoteImage> images = rawImages == null
                ? java.util.Collections.<NoteImage>emptyList() : rawImages;
        validateImages(safeBody, images);

        message.setFrom(new InternetAddress(effectiveFrom));
        message.setSubject(cleanTitle(title), StandardCharsets.UTF_8.name());
        message.setSentDate(now);
        message.setHeader("X-Mail-Created-Date",
                createdDate == null || createdDate.trim().isEmpty()
                        ? formatMailDate(now) : createdDate.trim());
        message.setHeader("X-Uniform-Type-Identifier", APPLE_NOTE_UTI);
        message.setHeader("X-Universally-Unique-Identifier", effectiveUuid);
        String completeHtml = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>"
                + safeBody + "</body></html>";
        if (images.isEmpty()) {
            message.setContent(completeHtml, "text/html; charset=UTF-8");
        } else {
            MimeBodyPart htmlPart = new MimeBodyPart();
            htmlPart.setContent(completeHtml, "text/html; charset=UTF-8");
            MimeMultipart related = new MimeMultipart("related");
            related.addBodyPart(htmlPart);
            for (NoteImage image : images) {
                MimeBodyPart imagePart = new MimeBodyPart();
                imagePart.setDataHandler(new DataHandler(new ByteArrayDataSource(
                        image.data, image.contentType
                )));
                imagePart.setFileName(cleanFilename(image.filename));
                imagePart.setDisposition(Part.INLINE);
                imagePart.setHeader("Content-ID", "<" + image.contentId + ">");
                imagePart.setHeader(
                        "Content-Type",
                        image.contentType + "; name=\"" + cleanFilename(image.filename)
                                + "\"; x-apple-part-url=\"" + image.contentId + "\""
                );
                related.addBodyPart(imagePart);
            }
            message.setContent(related);
        }
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
        String contentType = part.getContentType().split(";", 2)[0]
                .trim().toLowerCase(Locale.ROOT);
        if (isPreviewableImageType(contentType)
                && !Part.ATTACHMENT.equalsIgnoreCase(disposition)) {
            String contentId = cleanContentId(firstPartHeader(part, "Content-ID"));
            if (contentId.isEmpty()) {
                markUnsupported(result, "Ein eingebettetes Bild besitzt keine gültige Content-ID.");
                return;
            }
            int remaining = MAX_INLINE_IMAGE_BYTES - result.inlineImageBytes;
            byte[] data = remaining > 0 ? readPartBytes(part, remaining) : null;
            if (data == null) {
                markUnsupported(result, "Die eingebetteten Bilder sind zusammen größer als 6 MB.");
                return;
            }
            String key = contentId.toLowerCase(Locale.ROOT);
            if (result.inlineImages.containsKey(key)) {
                markUnsupported(result, "Mehrere Bilder verwenden dieselbe Content-ID.");
                return;
            }
            result.inlineImages.put(
                    key,
                    new NoteImage(contentId, normalizedImageType(contentType),
                            fileName == null || fileName.isEmpty() ? "image" : fileName, data)
            );
            result.inlineImageBytes += data.length;
            return;
        }
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

    private static boolean isPreviewableImageType(String contentType) {
        return "image/jpeg".equals(contentType)
                || "image/jpg".equals(contentType)
                || "image/png".equals(contentType)
                || "image/gif".equals(contentType)
                || "image/webp".equals(contentType);
    }

    private static String normalizedImageType(String contentType) {
        return "image/jpg".equals(contentType) ? "image/jpeg" : contentType;
    }

    private static String firstPartHeader(Part part, String name) throws Exception {
        String[] values = part.getHeader(name);
        return values == null || values.length == 0 || values[0] == null ? "" : values[0];
    }

    private static String cleanContentId(String value) {
        String clean = value == null ? "" : value.trim();
        if (clean.startsWith("<") && clean.endsWith(">") && clean.length() > 2) {
            clean = clean.substring(1, clean.length() - 1).trim();
        }
        return clean.isEmpty() || clean.matches(".*[<>\\s\\r\\n].*") ? "" : clean;
    }

    private static Set<String> referencedContentIds(String html) {
        Set<String> result = new HashSet<>();
        Matcher objects = APPLE_ATTACHMENT_OBJECT.matcher(html == null ? "" : html);
        while (objects.find()) {
            Matcher id = OBJECT_CONTENT_ID.matcher(objects.group());
            if (id.find()) {
                String contentId = cleanContentId(id.group(2));
                if (!contentId.isEmpty()) {
                    result.add(contentId.toLowerCase(Locale.ROOT));
                }
            }
        }
        return result;
    }

    private static void validateImages(String html, List<NoteImage> images) {
        Set<String> references = referencedContentIds(html);
        Set<String> imageIds = new HashSet<>();
        int total = 0;
        for (NoteImage image : images) {
            String contentId = cleanContentId(image == null ? "" : image.contentId);
            String contentType = image == null ? "" : normalizedImageType(
                    image.contentType == null ? "" : image.contentType.toLowerCase(Locale.ROOT)
            );
            if (contentId.isEmpty() || !isPreviewableImageType(contentType)
                    || image.data == null || image.data.length == 0) {
                throw new IllegalArgumentException("Die Notiz enthält ungültige Bilddaten.");
            }
            String key = contentId.toLowerCase(Locale.ROOT);
            if (!imageIds.add(key)) {
                throw new IllegalArgumentException("Mehrere Bilder verwenden dieselbe Content-ID.");
            }
            total += image.data.length;
            if (total > MAX_INLINE_IMAGE_BYTES) {
                throw new IllegalArgumentException("Bilder dürfen zusammen höchstens 6 MB groß sein.");
            }
        }
        if (!references.equals(imageIds)) {
            throw new IllegalArgumentException("Bildpositionen und Bildanhänge der Notiz stimmen nicht überein.");
        }
    }

    private static String cleanFilename(String value) {
        String clean = value == null || value.trim().isEmpty() ? "image" : value.trim();
        clean = clean.replace('"', '_').replace('\\', '_')
                .replace('\r', '_').replace('\n', '_');
        return clean.length() > 240 ? clean.substring(0, 240) : clean;
    }

    private static byte[] readPartBytes(Part part, int maximum) throws Exception {
        try (java.io.InputStream input = part.getInputStream();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (output.size() + count > maximum) {
                    return null;
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    public static String renderInlineImages(String html, List<NoteImage> rawImages) {
        Map<String, NoteImage> images = new LinkedHashMap<>();
        if (rawImages != null) {
            for (NoteImage image : rawImages) {
                String contentId = cleanContentId(image == null ? "" : image.contentId);
                if (!contentId.isEmpty()) {
                    images.put(contentId.toLowerCase(Locale.ROOT), image);
                }
            }
        }
        Matcher objectMatcher = APPLE_ATTACHMENT_OBJECT.matcher(html == null ? "" : html);
        StringBuffer rendered = new StringBuffer();
        while (objectMatcher.find()) {
            String object = objectMatcher.group();
            Matcher idMatcher = OBJECT_CONTENT_ID.matcher(object);
            NoteImage image = null;
            if (idMatcher.find()) {
                image = images.get(cleanContentId(idMatcher.group(2)).toLowerCase(Locale.ROOT));
            }
            String replacement;
            if (image == null) {
                replacement = "<div><i>[Anhang]</i></div>";
            } else {
                replacement = "<div class=\"apple-note-image\"><img src=\"data:"
                        + image.contentType + ";base64," + encodeBase64(image.data)
                        + "\" alt=\"" + escapeHtmlAttribute(image.filename)
                        + "\" data-apple-content-id=\"" + escapeHtmlAttribute(image.contentId)
                        + "\" data-apple-content-type=\"" + escapeHtmlAttribute(image.contentType)
                        + "\" data-apple-filename=\"" + escapeHtmlAttribute(image.filename)
                        + "\"></div>";
            }
            objectMatcher.appendReplacement(rendered, Matcher.quoteReplacement(replacement));
        }
        objectMatcher.appendTail(rendered);
        return rendered.toString();
    }

    private static String escapeHtmlAttribute(String value) {
        return (value == null ? "Bild" : value)
                .replace("&", "&amp;")
                .replace("\"", "&quot;")
                .replace("<", "&lt;")
                .replace(">", "&gt;");
    }

    private static String encodeBase64(byte[] data) {
        StringBuilder encoded = new StringBuilder((data.length + 2) / 3 * 4);
        for (int index = 0; index < data.length; index += 3) {
            int first = data[index] & 0xff;
            int second = index + 1 < data.length ? data[index + 1] & 0xff : 0;
            int third = index + 2 < data.length ? data[index + 2] & 0xff : 0;
            encoded.append(BASE64[first >>> 2]);
            encoded.append(BASE64[((first & 0x03) << 4) | (second >>> 4)]);
            encoded.append(index + 1 < data.length
                    ? BASE64[((second & 0x0f) << 2) | (third >>> 6)] : '=');
            encoded.append(index + 2 < data.length ? BASE64[third & 0x3f] : '=');
        }
        return encoded.toString();
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
        int inlineImageBytes;
        final Map<String, NoteImage> inlineImages = new LinkedHashMap<>();
    }
}
