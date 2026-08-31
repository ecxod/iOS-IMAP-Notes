package net.zp1.iosimapnotes.model;

public final class NoteImage {
    public String contentId = "";
    public String contentType = "";
    public String filename = "";
    public byte[] data = new byte[0];

    public NoteImage() {
    }

    public NoteImage(String contentId, String contentType, String filename, byte[] data) {
        this.contentId = contentId == null ? "" : contentId;
        this.contentType = contentType == null ? "" : contentType;
        this.filename = filename == null ? "" : filename;
        this.data = data == null ? new byte[0] : data;
    }
}
