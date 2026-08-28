package net.zp1.iosimapnotes.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class CredentialStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "ios-imap-notes-password-v1";
    private static final String PREFS = "encrypted_credentials";
    private static final String PASSWORD = "imap_password";

    private final SharedPreferences preferences;

    public CredentialStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public void savePassword(String password) throws Exception {
        SecretKey key = getOrCreateKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] encrypted = cipher.doFinal(password.getBytes(StandardCharsets.UTF_8));
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString(PASSWORD, value).commit()) {
            throw new IllegalStateException("Das Passwort konnte nicht gespeichert werden.");
        }
    }

    public String getPassword() throws Exception {
        String value = preferences.getString(PASSWORD, "");
        if (value == null || value.isEmpty()) {
            return "";
        }
        String[] parts = value.split(":", 2);
        if (parts.length != 2) {
            throw new IllegalStateException("Die gespeicherten Zugangsdaten sind beschädigt.");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))
        );
        byte[] decrypted = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
        return new String(decrypted, StandardCharsets.UTF_8);
    }

    public boolean hasPassword() {
        String value = preferences.getString(PASSWORD, "");
        return value != null && !value.isEmpty();
    }

    public void clear() {
        preferences.edit().remove(PASSWORD).apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
