package net.zp1.iosimapnotes.imap;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import net.zp1.iosimapnotes.model.Note;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Properties;

import javax.mail.Message;
import javax.mail.Session;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;

public final class AppleNoteCodecTest {
    @Test
    public void parsesExistingProjectFixture() throws Exception {
        byte[] source = fixture("apple-note.eml");
        Note note = AppleNoteCodec.parse(
                source, 1L, "Notes", 7L, 99L, new Date(1234L), "fallback@example.invalid"
        );

        assertNotNull(note);
        assertEquals("Einkauf", note.title);
        assertEquals("11111111-2222-4333-8444-555555555555", note.uuid);
        assertEquals(7L, note.uid);
        assertEquals(99L, note.uidValidity);
        assertTrue(note.bodyHtml.contains("Milch"));
        assertFalse(note.readOnly);
    }

    @Test
    public void ignoresOrdinaryMail() throws Exception {
        assertNull(AppleNoteCodec.parse(
                fixture("regular-message.eml"), 1L, "Notes", 8L, 99L,
                new Date(), "fallback@example.invalid"
        ));
    }

    @Test
    public void builderPreservesAppleHeadersAndUuid() throws Exception {
        Session session = Session.getInstance(new Properties());
        MimeMessage message = AppleNoteCodec.build(
                session,
                "Testnotiz",
                "Text<div><b>fett</b></div>",
                "test@example.invalid",
                "Wed, 26 Aug 2026 12:00:00 +0000",
                "11111111-2222-4333-8444-555555555555"
        );
        Note note = AppleNoteCodec.parse(
                AppleNoteCodec.toSource(message), 1L, "Notes", 10L, 99L,
                new Date(), "fallback@example.invalid"
        );

        assertNotNull(note);
        assertEquals("Testnotiz", note.title);
        assertEquals("11111111-2222-4333-8444-555555555555", note.uuid);
        assertTrue(note.bodyHtml.contains("<b>fett</b>"));
        assertFalse(note.readOnly);
    }

    @Test
    public void attachmentMakesNoteReadOnly() throws Exception {
        Session session = Session.getInstance(new Properties());
        MimeMessage message = AppleNoteCodec.build(
                session, "Mit Anhang", "Text", "test@example.invalid", "", ""
        );
        MimeBodyPart html = new MimeBodyPart();
        html.setContent("<html><body>Text</body></html>", "text/html; charset=UTF-8");
        MimeBodyPart attachment = new MimeBodyPart();
        attachment.setFileName("scan.txt");
        attachment.setText("Inhalt", StandardCharsets.UTF_8.name());
        MimeMultipart multipart = new MimeMultipart("mixed");
        multipart.addBodyPart(html);
        multipart.addBodyPart(attachment);
        message.setContent(multipart);
        message.saveChanges();

        Note note = AppleNoteCodec.parse(
                AppleNoteCodec.toSource(message), 1L, "Notes", 11L, 99L,
                new Date(), "fallback@example.invalid"
        );
        assertNotNull(note);
        assertTrue(note.readOnly);
        assertFalse(note.unsupportedReason.isEmpty());
    }

    @Test
    public void revisionChangesWithSource() throws Exception {
        assertFalse(AppleNoteCodec.sourceRevision("a".getBytes(StandardCharsets.UTF_8))
                .equals(AppleNoteCodec.sourceRevision("b".getBytes(StandardCharsets.UTF_8))));
    }

    private static byte[] fixture(String name) throws Exception {
        try (InputStream input = AppleNoteCodecTest.class.getResourceAsStream("/" + name)) {
            assertNotNull(input);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
}
