package net.zp1.iosimapnotes.ui;

final class UiErrors {
    private UiErrors() {
    }

    static String message(Throwable error) {
        Throwable current = error;
        String result = "Unbekannter Fehler";
        for (int depth = 0; current != null && depth < 8; depth++) {
            String text = current.getMessage();
            if (text != null && !text.trim().isEmpty()) {
                result = text.trim();
            }
            current = current.getCause();
        }
        result = result.replace('\r', ' ').replace('\n', ' ').trim();
        return result.length() > 300 ? result.substring(0, 300) + "…" : result;
    }
}
