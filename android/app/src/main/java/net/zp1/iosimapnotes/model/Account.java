package net.zp1.iosimapnotes.model;

public final class Account {
    public static final long DEFAULT_ID = 1L;
    public static final String SECURITY_TLS = "tls";
    public static final String SECURITY_STARTTLS = "starttls";

    public long id = DEFAULT_ID;
    public String name = "";
    public String host = "";
    public int port = 993;
    public String security = SECURITY_TLS;
    public String username = "";
    public String mailbox = "Notes";

    public boolean usesStartTls() {
        return SECURITY_STARTTLS.equals(security);
    }
}
