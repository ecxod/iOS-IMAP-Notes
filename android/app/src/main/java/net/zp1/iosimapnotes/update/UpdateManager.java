package net.zp1.iosimapnotes.update;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import net.zp1.iosimapnotes.BuildConfig;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class UpdateManager {
    private static final String RELEASES_URL =
            "https://api.github.com/repos/ecxod/iOS-IMAP-Notes/releases?per_page=30";
    private static final Pattern APK_NAME = Pattern.compile(
            "^ios-imap-notes-android-(\\d+)\\.(\\d+)\\.(\\d+)\\.apk$"
    );
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final long MAX_JSON_BYTES = 2L * 1024L * 1024L;
    private static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private UpdateManager() {
    }

    public interface Listener {
        void onStatus(String message);
        void onComplete(String message);
        void onError(String message);
    }

    public static void checkAndInstall(Activity activity, Listener listener) {
        IO.execute(() -> {
            try {
                listener.onStatus("GitHub-Releases werden geprüft …");
                UpdateAsset asset = findNewestAsset(readUrl(RELEASES_URL, MAX_JSON_BYTES));
                if (asset == null || compareVersions(asset.version, BuildConfig.VERSION_NAME) <= 0) {
                    listener.onComplete("Version " + BuildConfig.VERSION_NAME + " ist aktuell.");
                    return;
                }

                if (Build.VERSION.SDK_INT >= 26
                        && !activity.getPackageManager().canRequestPackageInstalls()) {
                    activity.runOnUiThread(() -> {
                        Intent permission = new Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName())
                        );
                        activity.startActivity(permission);
                    });
                    listener.onComplete(
                            "Bitte die Installation aus dieser Quelle erlauben und danach erneut auf Update tippen."
                    );
                    return;
                }

                listener.onStatus("Version " + asset.version + " wird sicher von GitHub geladen …");
                File directory = new File(activity.getCacheDir(), "updates");
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IllegalStateException("Der Update-Ordner konnte nicht angelegt werden.");
                }
                File apk = new File(directory, "ios-imap-notes-update.apk");
                download(asset.url, apk);
                try {
                    VerifiedApk verified = verifyApk(activity.getPackageManager(), apk, activity.getPackageName());
                    if (verified.versionCode <= BuildConfig.VERSION_CODE) {
                        listener.onComplete("Die geladene APK enthält keine neuere App-Version.");
                        return;
                    }
                    if (!asset.version.equals(verified.versionName)) {
                        throw new SecurityException(
                                "APK-Dateiname und enthaltene Versionsnummer stimmen nicht überein."
                        );
                    }
                    listener.onStatus("Signatur geprüft. Android bereitet die Installation vor …");
                    install(activity, apk);
                    listener.onComplete(
                            "Version " + verified.versionName + " ist bereit. Bitte die Android-Installation bestätigen."
                    );
                } finally {
                    if (apk.exists() && !apk.delete()) {
                        apk.deleteOnExit();
                    }
                }
            } catch (Exception error) {
                String message = error.getMessage();
                listener.onError(message == null || message.trim().isEmpty()
                        ? error.getClass().getSimpleName() : message);
            }
        });
    }

    static UpdateAsset findNewestAsset(String json) throws Exception {
        JSONArray releases = new JSONArray(json);
        UpdateAsset best = null;
        for (int releaseIndex = 0; releaseIndex < releases.length(); releaseIndex++) {
            JSONObject release = releases.getJSONObject(releaseIndex);
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) {
                continue;
            }
            JSONArray assets = release.optJSONArray("assets");
            if (assets == null) continue;
            for (int assetIndex = 0; assetIndex < assets.length(); assetIndex++) {
                JSONObject candidate = assets.getJSONObject(assetIndex);
                String name = candidate.optString("name");
                Matcher matcher = APK_NAME.matcher(name);
                if (!matcher.matches()) continue;
                String version = matcher.group(1) + "." + matcher.group(2) + "." + matcher.group(3);
                String url = candidate.optString("browser_download_url");
                if (!url.startsWith("https://github.com/")) continue;
                if (best == null || compareVersions(version, best.version) > 0) {
                    best = new UpdateAsset(version, url);
                }
            }
        }
        return best;
    }

    static int compareVersions(String left, String right) {
        int[] leftParts = versionParts(left);
        int[] rightParts = versionParts(right);
        for (int index = 0; index < 3; index++) {
            int comparison = Integer.compare(leftParts[index], rightParts[index]);
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    private static int[] versionParts(String version) {
        Matcher matcher = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)(?:[-+].*)?$").matcher(version);
        if (!matcher.matches()) return new int[]{0, 0, 0};
        return new int[]{
                Integer.parseInt(matcher.group(1)),
                Integer.parseInt(matcher.group(2)),
                Integer.parseInt(matcher.group(3))
        };
    }

    private static String readUrl(String address, long maximumBytes) throws Exception {
        HttpURLConnection connection = open(address);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("GitHub antwortete mit HTTP " + connection.getResponseCode() + ".");
            }
            requireHttps(connection);
            return new String(readLimited(connection.getInputStream(), maximumBytes), "UTF-8");
        } finally {
            connection.disconnect();
        }
    }

    private static void download(String address, File target) throws Exception {
        HttpURLConnection connection = open(address);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("Der APK-Download antwortete mit HTTP "
                        + connection.getResponseCode() + ".");
            }
            requireHttps(connection);
            long declaredSize = connection.getContentLength();
            if (declaredSize > MAX_APK_BYTES) {
                throw new IllegalStateException("Die Update-APK ist unerwartet groß.");
            }
            long written = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    written += count;
                    if (written > MAX_APK_BYTES) {
                        throw new IllegalStateException("Die Update-APK ist unerwartet groß.");
                    }
                    output.write(buffer, 0, count);
                }
            }
            if (written == 0) {
                throw new IllegalStateException("GitHub lieferte eine leere APK.");
            }
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection open(String address) throws Exception {
        URL url = new URL(address);
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new IllegalArgumentException("Updates dürfen nur über HTTPS geladen werden.");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "iOS-IMAP-Notes-Android/" + BuildConfig.VERSION_NAME);
        return connection;
    }

    private static void requireHttps(HttpURLConnection connection) {
        if (!"https".equalsIgnoreCase(connection.getURL().getProtocol())) {
            throw new SecurityException("Ein Update-Redirect hat HTTPS verlassen.");
        }
    }

    private static byte[] readLimited(InputStream source, long maximumBytes) throws Exception {
        try (InputStream input = new BufferedInputStream(source);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > maximumBytes) {
                    throw new IllegalStateException("Die GitHub-Antwort ist unerwartet groß.");
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    @SuppressWarnings("deprecation")
    private static VerifiedApk verifyApk(
            PackageManager packageManager,
            File apk,
            String expectedPackage
    ) throws Exception {
        int flags = Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo info = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (info == null || !expectedPackage.equals(info.packageName)) {
            throw new SecurityException("Die APK gehört nicht zu dieser App.");
        }
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null) {
                throw new SecurityException("Die APK enthält keine prüfbare Signatur.");
            }
            signatures = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
        } else {
            signatures = info.signatures;
        }
        boolean trusted = false;
        if (signatures != null) {
            for (Signature signature : signatures) {
                if (BuildConfig.RELEASE_CERT_SHA256.equalsIgnoreCase(sha256(signature.toByteArray()))) {
                    trusted = true;
                    break;
                }
            }
        }
        if (!trusted) {
            throw new SecurityException("Die APK-Signatur stimmt nicht mit der Release-Signatur überein.");
        }
        long versionCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        return new VerifiedApk(versionCode, info.versionName == null ? "?" : info.versionName);
    }

    private static String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder(digest.length * 2);
        for (byte item : digest) {
            result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        }
        return result.toString();
    }

    private static void install(Activity activity, File apk) throws Exception {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams parameters = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        parameters.setAppPackageName(activity.getPackageName());
        int sessionId = installer.createSession(parameters);
        try (PackageInstaller.Session session = installer.openSession(sessionId);
             InputStream input = new BufferedInputStream(new FileInputStream(apk));
             OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            session.fsync(output);

            Intent result = new Intent(UpdateInstallReceiver.ACTION_INSTALL_RESULT);
            result.setComponent(new ComponentName(activity, UpdateInstallReceiver.class));
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pending = PendingIntent.getBroadcast(activity, sessionId, result, flags);
            session.commit(pending.getIntentSender());
        } catch (Exception error) {
            installer.abandonSession(sessionId);
            throw error;
        }
    }

    static final class UpdateAsset {
        final String version;
        final String url;

        UpdateAsset(String version, String url) {
            this.version = version;
            this.url = url;
        }
    }

    private static final class VerifiedApk {
        final long versionCode;
        final String versionName;

        VerifiedApk(long versionCode, String versionName) {
            this.versionCode = versionCode;
            this.versionName = versionName;
        }
    }
}
