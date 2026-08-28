package net.zp1.iosimapnotes.ui;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AppTasks {
    static final ExecutorService IO = Executors.newFixedThreadPool(3);

    private AppTasks() {
    }
}
