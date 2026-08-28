package net.zp1.iosimapnotes.model;

public final class Account {
    public static final String SECURITY_TLS = "tls";
    public static final String SECURITY_STARTTLS = "starttls";
    public static final String AUTH_AUTO = "auto";
    public static final String AUTH_CRAM_MD5 = "cram-md5";
    public static final String AUTH_PLAIN = "plain";
    public static final String AUTH_LOGIN = "login";

    public long id;
    public String name = "";
    public String host = "";
    public int port = 993;
    public String security = SECURITY_TLS;
    public String authentication = AUTH_AUTO;
    public String username = "";
    public String mailbox = "Notes";

    public boolean usesStartTls() {
        return SECURITY_STARTTLS.equals(security);
    }
}
