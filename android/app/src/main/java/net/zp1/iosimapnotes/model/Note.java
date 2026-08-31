package net.zp1.iosimapnotes.model;

import java.util.ArrayList;
import java.util.List;

public final class Note {
    public String id = "";
    public long accountId;
    public String title = "";
    public String bodyHtml = "";
    public final List<NoteImage> images = new ArrayList<>();
    public long updatedAt;
    public String mailbox = "";
    public long uid;
    public long uidValidity;
    public String uuid = "";
    public String revision = "";
    public String createdDate = "";
    public String fromAddress = "";
    public boolean readOnly;
    public String unsupportedReason = "";
}
