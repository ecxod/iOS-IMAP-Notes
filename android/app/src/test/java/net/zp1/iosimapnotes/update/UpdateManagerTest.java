package net.zp1.iosimapnotes.update;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class UpdateManagerTest {
    @Test
    public void comparesSemanticAndroidVersions() {
        assertEquals(1, UpdateManager.compareVersions("1.10.0", "1.9.9"));
        assertEquals(-1, UpdateManager.compareVersions("1.0.9", "1.1.0"));
        assertEquals(0, UpdateManager.compareVersions("1.1.0", "1.1.0"));
    }
}
