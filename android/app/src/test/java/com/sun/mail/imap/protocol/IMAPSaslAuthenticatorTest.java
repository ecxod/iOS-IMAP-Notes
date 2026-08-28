package com.sun.mail.imap.protocol;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

import static org.junit.Assert.assertTrue;

public final class IMAPSaslAuthenticatorTest {
    @Test
    public void completesCramMd5ChallengeThroughJavaMailProtocol() throws Exception {
        String responses = "* CAPABILITY IMAP4rev1 AUTH=CRAM-MD5\r\n"
                + "A0 OK CAPABILITY completed\r\n"
                + "+ PDE4OTYuNjk3MTcwOTUyQHBvc3RvZmZpY2UucmVzdG9uLm1jaS5uZXQ+\r\n"
                + "A1 OK AUTHENTICATE completed\r\n";
        ByteArrayOutputStream commands = new ByteArrayOutputStream();
        IMAPProtocol protocol = new IMAPProtocol(
                new ByteArrayInputStream(responses.getBytes(StandardCharsets.US_ASCII)),
                new PrintStream(commands, true, "US-ASCII"),
                new Properties(),
                false
        );
        protocol.capability();

        IMAPSaslAuthenticator authenticator = new IMAPSaslAuthenticator(
                protocol, "imap", new Properties(), null, "imap.example.org"
        );

        assertTrue(authenticator.authenticate(
                new String[]{"CRAM-MD5"}, null, null, "tim", "tanstaaftanstaaf"
        ));
        String sent = commands.toString("US-ASCII");
        assertTrue(sent.contains("A1 AUTHENTICATE CRAM-MD5\r\n"));
        assertTrue(sent.contains(
                "dGltIGI5MTNhNjAyYzdlZGE3YTQ5NWI0ZTZlNzMzNGQzODkw\r\n"
        ));
    }
}
