package com.sun.mail.imap.protocol;

import com.sun.mail.iap.ByteArray;
import com.sun.mail.iap.ProtocolException;
import com.sun.mail.iap.Response;
import com.sun.mail.util.MailLogger;

import net.zp1.iosimapnotes.imap.CramMd5;

import java.io.OutputStream;
import java.util.Locale;
import java.util.Properties;

/**
 * Android JavaMail omits the desktop SASL implementation. This narrowly scoped
 * authenticator supplies RFC 2195 CRAM-MD5 to IMAPProtocol's existing SASL hook.
 */
public final class IMAPSaslAuthenticator implements SaslAuthenticator {
    private static final byte[] CRLF = new byte[]{'\r', '\n'};

    private final IMAPProtocol protocol;

    public IMAPSaslAuthenticator(
            IMAPProtocol protocol,
            String name,
            Properties properties,
            MailLogger logger,
            String host
    ) {
        this.protocol = protocol;
    }

    @Override
    public boolean authenticate(
            String[] mechanisms,
            String realm,
            String authorizationId,
            String username,
            String password
    ) throws ProtocolException {
        if (!containsCramMd5(mechanisms) || !protocol.hasCapability("AUTH=CRAM-MD5")) {
            return false;
        }

        try {
            String tag = protocol.writeCommand("AUTHENTICATE CRAM-MD5", null);
            Response challengeResponse = protocol.readResponse();
            if (!challengeResponse.isContinuation()) {
                protocol.handleLoginResult(challengeResponse);
                return false;
            }
            ByteArray challenge = challengeResponse.readByteArray();
            if (challenge == null || challenge.getCount() == 0) {
                throw new ProtocolException("Der Server hat keine CRAM-MD5-Challenge gesendet.");
            }

            OutputStream output = protocol.getIMAPOutputStream();
            output.write(CramMd5.response(
                    challenge.getNewBytes(), username, password
            ));
            output.write(CRLF);
            output.flush();

            Response finalResponse = null;
            while (finalResponse == null) {
                Response response = protocol.readResponse();
                if (response.isBYE()) {
                    finalResponse = response;
                } else if (response.isTagged() && tag.equals(response.getTag())) {
                    finalResponse = response;
                }
            }
            protocol.handleLoginResult(finalResponse);
            protocol.setCapabilities(finalResponse);
            return true;
        } catch (ProtocolException error) {
            throw error;
        } catch (Exception error) {
            throw new ProtocolException("CRAM-MD5-Authentifizierung fehlgeschlagen.", error);
        }
    }

    private static boolean containsCramMd5(String[] mechanisms) {
        if (mechanisms == null) {
            return false;
        }
        for (String mechanism : mechanisms) {
            if ("CRAM-MD5".equals(mechanism.toUpperCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }
}
