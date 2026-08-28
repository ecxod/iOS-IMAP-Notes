package net.zp1.iosimapnotes.imap;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;

public final class CramMd5Test {
    @Test
    public void createsRfc2195Response() throws Exception {
        byte[] response = CramMd5.response(
                "PDE4OTYuNjk3MTcwOTUyQHBvc3RvZmZpY2UucmVzdG9uLm1jaS5uZXQ+"
                        .getBytes(StandardCharsets.US_ASCII),
                "tim",
                "tanstaaftanstaaf"
        );

        assertEquals(
                "dGltIGI5MTNhNjAyYzdlZGE3YTQ5NWI0ZTZlNzMzNGQzODkw",
                new String(response, StandardCharsets.US_ASCII)
        );
    }
}
