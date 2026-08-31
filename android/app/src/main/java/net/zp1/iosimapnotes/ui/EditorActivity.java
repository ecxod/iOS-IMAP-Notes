package net.zp1.iosimapnotes.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.LocaleList;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Base64;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.data.AppDatabase;
import net.zp1.iosimapnotes.imap.AppleNoteCodec;
import net.zp1.iosimapnotes.imap.ImapRepository;
import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;
import net.zp1.iosimapnotes.model.NoteImage;
import net.zp1.iosimapnotes.security.CredentialStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class EditorActivity extends Activity {
    public static final String EXTRA_NOTE_ID = "note_id";
    public static final String EXTRA_ACCOUNT_ID = "account_id";
    private static final String EDITOR_PREFERENCES = "editor_preferences";
    private static final String SPELL_LANGUAGE = "spell_language";
    private static final int PICK_IMAGE_REQUEST = 4107;
    private static final String EDITOR_URL =
            "https://appassets.androidplatform.net/assets/editor/index.html";
    private static final String[] LANGUAGE_LABELS = {
            "Systemsprache", "Deutsch", "English", "Română", "Français", "Italiano", "Español"
    };
    private static final String[] LANGUAGE_TAGS = {"", "de", "en", "ro", "fr", "it", "es"};

    private AppDatabase database;
    private CredentialStore credentialStore;
    private final ImapRepository repository = new ImapRepository();
    private EditText titleField;
    private WebView bodyEditor;
    private Button saveButton;
    private Button deleteButton;
    private Button languageButton;
    private ProgressBar progress;
    private TextView status;
    private Note note;
    private Account account;
    private boolean loading = true;
    private boolean editorReady;
    private boolean dirty;
    private boolean busy;
    private ValueCallback<Uri[]> imageFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_editor);
        database = new AppDatabase(this);
        credentialStore = new CredentialStore(this);
        titleField = findViewById(R.id.titleField);
        bodyEditor = findViewById(R.id.bodyEditor);
        saveButton = findViewById(R.id.editorSaveButton);
        deleteButton = findViewById(R.id.deleteButton);
        progress = findViewById(R.id.editorProgress);
        status = findViewById(R.id.editorStatus);
        languageButton = findViewById(R.id.languageButton);

        String noteId = getIntent().getStringExtra(EXTRA_NOTE_ID);
        note = noteId == null ? null : database.getNote(noteId);
        if (noteId != null && note == null) {
            Toast.makeText(this, "Die Notiz wurde nicht gefunden. Bitte synchronisieren.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        long accountId = note != null
                ? note.accountId
                : getIntent().getLongExtra(EXTRA_ACCOUNT_ID, 0L);
        account = accountId > 0 ? database.getAccount(accountId) : null;
        if (account == null) {
            Toast.makeText(this, "Das IMAP-Konto dieser Notiz wurde nicht gefunden.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        ((TextView) findViewById(R.id.editorHeader)).setText(account.name);
        if (note != null) {
            titleField.setText(note.title);
            deleteButton.setVisibility(View.VISIBLE);
            if (note.readOnly) {
                setReadOnly(note.unsupportedReason);
            }
        } else {
            deleteButton.setVisibility(View.GONE);
        }

        titleField.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                if (!loading) {
                    dirty = true;
                }
            }
            @Override public void afterTextChanged(Editable s) { }
        });

        findViewById(R.id.editorBackButton).setOnClickListener(view -> requestClose());
        saveButton.setOnClickListener(view -> save());
        deleteButton.setOnClickListener(view -> confirmDelete());
        languageButton.setOnClickListener(view -> chooseLanguage());
        configureEditor();
        applyLanguage(getPreferences().getString(SPELL_LANGUAGE, ""));
        loading = false;
    }

    private void configureEditor() {
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        WebSettings settings = bodyEditor.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        bodyEditor.addJavascriptInterface(new EditorBridge(), "NativeEditor");
        bodyEditor.setWebViewClient(new WebViewClientCompat() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !EDITOR_URL.equals(request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !EDITOR_URL.equals(url);
            }
        });
        bodyEditor.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (imageFileCallback != null) {
                    imageFileCallback.onReceiveValue(null);
                }
                imageFileCallback = filePathCallback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("image/*");
                picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "image/jpeg", "image/png", "image/gif", "image/webp"
                });
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(picker, PICK_IMAGE_REQUEST);
                    return true;
                } catch (Exception error) {
                    imageFileCallback = null;
                    Toast.makeText(EditorActivity.this,
                            "Der Bildwähler konnte nicht geöffnet werden.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        bodyEditor.loadUrl(EDITOR_URL);
    }

    private final class EditorBridge {
        @JavascriptInterface
        public void ready(String ignored) {
            runOnUiThread(() -> {
                editorReady = true;
                loadEditorNote();
                applyEditorLanguage(getPreferences().getString(SPELL_LANGUAGE, ""));
            });
        }

        @JavascriptInterface
        public void changed(String ignored) {
            runOnUiThread(() -> {
                if (!loading && !busy && (note == null || !note.readOnly)) {
                    dirty = true;
                }
            });
        }

        @JavascriptInterface
        public void error(String message) {
            runOnUiThread(() -> Toast.makeText(
                    EditorActivity.this, message, Toast.LENGTH_LONG
            ).show());
        }
    }

    private void loadEditorNote() {
        if (!editorReady) {
            return;
        }
        JSONArray images = new JSONArray();
        if (note != null) {
            for (NoteImage image : note.images) {
                JSONObject value = new JSONObject();
                try {
                    value.put("contentId", image.contentId);
                    value.put("contentType", image.contentType);
                    value.put("filename", image.filename);
                    value.put("dataBase64", Base64.encodeToString(image.data, Base64.NO_WRAP));
                    images.put(value);
                } catch (Exception error) {
                    setReadOnly("Mindestens ein Bild konnte nicht für den Editor vorbereitet werden.");
                }
            }
        }
        String bodyHtml = note == null ? "<div><br></div>" : note.bodyHtml;
        boolean readOnly = note != null && note.readOnly;
        bodyEditor.evaluateJavascript(
                "window.noteEditor.loadNote("
                        + JSONObject.quote(bodyHtml) + "," + images + "," + readOnly + ")",
                null
        );
    }

    private void setReadOnly(String reason) {
        titleField.setEnabled(false);
        saveButton.setVisibility(View.GONE);
        languageButton.setEnabled(false);
        status.setText(reason == null || reason.isEmpty()
                ? "Diese Notiz ist schreibgeschützt." : reason);
        status.setVisibility(View.VISIBLE);
        setEditorReadOnly(true);
    }

    private void setEditorReadOnly(boolean readOnly) {
        if (editorReady) {
            bodyEditor.evaluateJavascript(
                    "window.noteEditor.setReadOnly(" + readOnly + ")", null
            );
        }
    }

    private void save() {
        if (busy || !editorReady) {
            return;
        }
        if (account == null) {
            Toast.makeText(this, "Bitte zuerst das IMAP-Konto einrichten.", Toast.LENGTH_LONG).show();
            return;
        }
        String title = titleField.getText().toString().trim();
        if (title.isEmpty()) {
            titleField.requestFocus();
            Toast.makeText(this, "Bitte einen Titel eingeben.", Toast.LENGTH_SHORT).show();
            return;
        }
        setBusy(true, "Notiz wird vorbereitet …");
        bodyEditor.evaluateJavascript("window.noteEditor.exportJson()", encoded -> {
            try {
                String json = new JSONArray("[" + encoded + "]").getString(0);
                JSONObject result = new JSONObject(json);
                if (!result.optBoolean("ok")) {
                    throw new IllegalArgumentException(result.optString(
                            "error", "Der Editorinhalt konnte nicht gelesen werden."
                    ));
                }
                JSONObject content = result.getJSONObject("note");
                String bodyHtml = content.getString("bodyHtml");
                if (bodyHtml.length() > AppleNoteCodec.MAX_BODY_LENGTH) {
                    throw new IllegalArgumentException("Die Notiz darf höchstens 10 MB groß sein.");
                }
                List<NoteImage> images = parseImages(content.getJSONArray("images"));
                persist(title, bodyHtml, images);
            } catch (Exception error) {
                setBusy(false, UiErrors.message(error));
                Toast.makeText(this, UiErrors.message(error), Toast.LENGTH_LONG).show();
            }
        });
    }

    private static List<NoteImage> parseImages(JSONArray values) throws Exception {
        List<NoteImage> images = new ArrayList<>();
        int totalBytes = 0;
        for (int index = 0; index < values.length(); index++) {
            JSONObject value = values.getJSONObject(index);
            byte[] data = Base64.decode(value.getString("dataBase64"), Base64.DEFAULT);
            totalBytes += data.length;
            if (totalBytes > AppleNoteCodec.MAX_INLINE_IMAGE_BYTES) {
                throw new IllegalArgumentException("Bilder dürfen zusammen höchstens 6 MB groß sein.");
            }
            images.add(new NoteImage(
                    value.getString("contentId"),
                    value.getString("contentType"),
                    value.optString("filename", "image"),
                    data
            ));
        }
        return images;
    }

    private void persist(String title, String bodyHtml, List<NoteImage> images) {
        setBusy(true, "Notiz wird sicher gespeichert …");
        AppTasks.IO.execute(() -> {
            try {
                String password = credentialStore.getPassword(account.id);
                if (note == null) {
                    Note created = repository.create(account, password, title, bodyHtml, images);
                    database.saveNote(created);
                    runOnUiThread(() -> finishAfterSave("Notiz gespeichert."));
                } else {
                    note.title = title;
                    note.bodyHtml = bodyHtml;
                    note.images.clear();
                    note.images.addAll(images);
                    ImapRepository.SaveResult result = repository.save(account, password, note);
                    database.saveNote(result.note);
                    runOnUiThread(() -> finishAfterSave(
                            result.warning.isEmpty() ? "Notiz gespeichert." : result.warning
                    ));
                }
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, UiErrors.message(error));
                    Toast.makeText(this, UiErrors.message(error), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void finishAfterSave(String message) {
        dirty = false;
        setBusy(false, message);
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }

    private void confirmDelete() {
        if (note == null || busy) {
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Notiz löschen?")
                .setMessage("Die Notiz wird nach einer erneuten Konfliktprüfung vom IMAP-Server gelöscht.")
                .setPositiveButton("Löschen", (dialog, which) -> deleteNote())
                .setNegativeButton("Abbrechen", null)
                .show();
    }

    private void deleteNote() {
        if (account == null || note == null) {
            return;
        }
        setBusy(true, "Notiz wird gelöscht …");
        AppTasks.IO.execute(() -> {
            try {
                repository.delete(account, credentialStore.getPassword(account.id), note);
                database.deleteNote(note.id);
                runOnUiThread(() -> {
                    dirty = false;
                    Toast.makeText(this, "Notiz gelöscht.", Toast.LENGTH_SHORT).show();
                    finish();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, UiErrors.message(error));
                    Toast.makeText(this, UiErrors.message(error), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void setBusy(boolean value, String message) {
        busy = value;
        progress.setVisibility(value ? View.VISIBLE : View.GONE);
        saveButton.setEnabled(!value);
        deleteButton.setEnabled(!value);
        titleField.setEnabled(!value && (note == null || !note.readOnly));
        bodyEditor.setEnabled(!value);
        setEditorReadOnly(value || note != null && note.readOnly);
        status.setText(message);
        status.setVisibility(message == null || message.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void requestClose() {
        if (busy) {
            return;
        }
        if (!dirty || note != null && note.readOnly) {
            finish();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Änderungen verwerfen?")
                .setMessage("Die Änderungen wurden noch nicht auf dem IMAP-Server gespeichert.")
                .setPositiveButton("Verwerfen", (dialog, which) -> finish())
                .setNegativeButton("Weiter bearbeiten", null)
                .show();
    }

    private void chooseLanguage() {
        String selectedTag = getPreferences().getString(SPELL_LANGUAGE, "");
        int selected = 0;
        for (int index = 0; index < LANGUAGE_TAGS.length; index++) {
            if (LANGUAGE_TAGS[index].equals(selectedTag)) {
                selected = index;
                break;
            }
        }
        new AlertDialog.Builder(this)
                .setTitle("Sprache der Rechtschreibprüfung")
                .setSingleChoiceItems(LANGUAGE_LABELS, selected, (dialog, which) -> {
                    String tag = LANGUAGE_TAGS[which];
                    getPreferences().edit().putString(SPELL_LANGUAGE, tag).apply();
                    applyLanguage(tag);
                    dialog.dismiss();
                })
                .setNegativeButton("Abbrechen", null)
                .show();
    }

    private void applyLanguage(String tag) {
        Locale locale = tag == null || tag.isEmpty() ? Locale.getDefault() : Locale.forLanguageTag(tag);
        titleField.setTextLocale(locale);
        if (Build.VERSION.SDK_INT >= 24) {
            titleField.setImeHintLocales(new LocaleList(locale));
        }
        languageButton.setText(tag == null || tag.isEmpty()
                ? "Spr.: Auto"
                : "Spr.: " + locale.getLanguage().toUpperCase(Locale.ROOT));
        applyEditorLanguage(tag);
        InputMethodManager input = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (input != null) {
            input.restartInput(titleField);
            input.restartInput(bodyEditor);
        }
    }

    private void applyEditorLanguage(String tag) {
        if (editorReady) {
            String effectiveTag = tag == null || tag.isEmpty()
                    ? Locale.getDefault().toLanguageTag() : tag;
            bodyEditor.evaluateJavascript(
                    "window.noteEditor.setLanguage(" + JSONObject.quote(effectiveTag) + ")", null
            );
        }
    }

    private SharedPreferences getPreferences() {
        return getSharedPreferences(EDITOR_PREFERENCES, MODE_PRIVATE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_IMAGE_REQUEST) {
            ValueCallback<Uri[]> callback = imageFileCallback;
            imageFileCallback = null;
            if (callback != null) {
                callback.onReceiveValue(resultCode == RESULT_OK
                        ? WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                        : null);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        requestClose();
    }

    @Override
    protected void onDestroy() {
        if (imageFileCallback != null) {
            imageFileCallback.onReceiveValue(null);
            imageFileCallback = null;
        }
        if (bodyEditor != null) {
            bodyEditor.removeJavascriptInterface("NativeEditor");
            bodyEditor.stopLoading();
            bodyEditor.destroy();
        }
        super.onDestroy();
    }
}
