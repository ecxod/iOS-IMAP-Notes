package net.zp1.iosimapnotes.imap;

import com.sun.mail.util.BASE64DecoderStream;
import com.sun.mail.util.BASE64EncoderStream;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class CramMd5 {
    private CramMd5() {
    }

    public static byte[] response(byte[] encodedChallenge, String username, String password)
            throws Exception {
        byte[] challenge = BASE64DecoderStream.decode(encodedChallenge);
        Mac mac = Mac.getInstance("HmacMD5");
        mac.init(new SecretKeySpec(password.getBytes(StandardCharsets.UTF_8), "HmacMD5"));
        byte[] digest = mac.doFinal(challenge);
        StringBuilder hexadecimal = new StringBuilder(digest.length * 2);
        for (byte value : digest) {
            hexadecimal.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        }
        String clearResponse = username + " " + hexadecimal;
        return BASE64EncoderStream.encode(clearResponse.getBytes(StandardCharsets.UTF_8));
    }
}
