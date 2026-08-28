package net.zp1.iosimapnotes.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.LocaleList;
import android.text.Editable;
import android.text.Html;
import android.text.Spanned;
import android.text.TextWatcher;
import android.text.style.StyleSpan;
import android.text.style.UnderlineSpan;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.view.inputmethod.InputMethodManager;

import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.data.AppDatabase;
import net.zp1.iosimapnotes.imap.ImapRepository;
import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;
import net.zp1.iosimapnotes.security.CredentialStore;

import java.util.Locale;

public final class EditorActivity extends Activity {
    public static final String EXTRA_NOTE_ID = "note_id";
    public static final String EXTRA_ACCOUNT_ID = "account_id";
    private static final String EDITOR_PREFERENCES = "editor_preferences";
    private static final String SPELL_LANGUAGE = "spell_language";
    private static final String[] LANGUAGE_LABELS = {
            "Systemsprache", "Deutsch", "English", "Română", "Français", "Italiano", "Español"
    };
    private static final String[] LANGUAGE_TAGS = {"", "de", "en", "ro", "fr", "it", "es"};

    private AppDatabase database;
    private CredentialStore credentialStore;
    private final ImapRepository repository = new ImapRepository();
    private EditText titleField;
    private EditText bodyField;
    private Button saveButton;
    private Button deleteButton;
    private ProgressBar progress;
    private TextView status;
    private Note note;
    private Account account;
    private Button languageButton;
    private boolean loading = true;
    private boolean dirty;
    private boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_editor);
        database = new AppDatabase(this);
        credentialStore = new CredentialStore(this);
        titleField = findViewById(R.id.titleField);
        bodyField = findViewById(R.id.bodyField);
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
            bodyField.setText(fromHtml(note.bodyHtml));
            deleteButton.setVisibility(View.VISIBLE);
            if (note.readOnly) {
                setReadOnly(note.unsupportedReason);
            }
        } else {
            deleteButton.setVisibility(View.GONE);
            bodyField.setText("");
        }
        loading = false;

        TextWatcher watcher = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                if (!loading) dirty = true;
            }
            @Override public void afterTextChanged(Editable s) { }
        };
        titleField.addTextChangedListener(watcher);
        bodyField.addTextChangedListener(watcher);

        findViewById(R.id.editorBackButton).setOnClickListener(view -> requestClose());
        saveButton.setOnClickListener(view -> save());
        deleteButton.setOnClickListener(view -> confirmDelete());
        findViewById(R.id.boldButton).setOnClickListener(view -> applySpan(new StyleSpan(Typeface.BOLD)));
        findViewById(R.id.italicButton).setOnClickListener(view -> applySpan(new StyleSpan(Typeface.ITALIC)));
        findViewById(R.id.underlineButton).setOnClickListener(view -> applySpan(new UnderlineSpan()));
        languageButton.setOnClickListener(view -> chooseLanguage());
        applyLanguage(getPreferences().getString(SPELL_LANGUAGE, ""));
    }

    private void setReadOnly(String reason) {
        titleField.setEnabled(false);
        bodyField.setEnabled(false);
        saveButton.setVisibility(View.GONE);
        findViewById(R.id.formatToolbar).setEnabled(false);
        findViewById(R.id.boldButton).setEnabled(false);
        findViewById(R.id.italicButton).setEnabled(false);
        findViewById(R.id.underlineButton).setEnabled(false);
        status.setText(reason == null || reason.isEmpty()
                ? "Diese Notiz ist schreibgeschützt." : reason);
        status.setVisibility(View.VISIBLE);
    }

    private void applySpan(Object span) {
        int start = Math.min(bodyField.getSelectionStart(), bodyField.getSelectionEnd());
        int end = Math.max(bodyField.getSelectionStart(), bodyField.getSelectionEnd());
        if (start < 0 || end <= start) {
            Toast.makeText(this, "Bitte zuerst Text auswählen.", Toast.LENGTH_SHORT).show();
            return;
        }
        bodyField.getText().setSpan(span, start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        dirty = true;
    }

    private void save() {
        if (busy) return;
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
        String bodyHtml = toHtml(bodyField.getText());
        setBusy(true, "Notiz wird sicher gespeichert …");
        AppTasks.IO.execute(() -> {
            try {
                String password = credentialStore.getPassword(account.id);
                if (note == null) {
                    Note created = repository.create(account, password, title, bodyHtml);
                    database.saveNote(created);
                    runOnUiThread(() -> finishAfterSave("Notiz gespeichert."));
                } else {
                    note.title = title;
                    note.bodyHtml = bodyHtml;
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
        if (note == null || busy) return;
        new AlertDialog.Builder(this)
                .setTitle("Notiz löschen?")
                .setMessage("Die Notiz wird nach einer erneuten Konfliktprüfung vom IMAP-Server gelöscht.")
                .setPositiveButton("Löschen", (dialog, which) -> deleteNote())
                .setNegativeButton("Abbrechen", null)
                .show();
    }

    private void deleteNote() {
        if (account == null || note == null) return;
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
        bodyField.setEnabled(!value && (note == null || !note.readOnly));
        status.setText(message);
        status.setVisibility(message == null || message.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void requestClose() {
        if (busy) return;
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
        bodyField.setTextLocale(locale);
        if (Build.VERSION.SDK_INT >= 24) {
            LocaleList locales = new LocaleList(locale);
            titleField.setImeHintLocales(locales);
            bodyField.setImeHintLocales(locales);
        }
        languageButton.setText(tag == null || tag.isEmpty()
                ? "Spr.: Auto"
                : "Spr.: " + locale.getLanguage().toUpperCase(Locale.ROOT));
        InputMethodManager input = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (input != null) {
            input.restartInput(titleField);
            input.restartInput(bodyField);
        }
    }

    private SharedPreferences getPreferences() {
        return getSharedPreferences(EDITOR_PREFERENCES, MODE_PRIVATE);
    }

    @Override
    public void onBackPressed() {
        requestClose();
    }

    @SuppressWarnings("deprecation")
    private static Spanned fromHtml(String html) {
        if (Build.VERSION.SDK_INT >= 24) {
            return Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY);
        }
        return Html.fromHtml(html);
    }

    @SuppressWarnings("deprecation")
    private static String toHtml(Spanned text) {
        if (Build.VERSION.SDK_INT >= 24) {
            return Html.toHtml(text, Html.TO_HTML_PARAGRAPH_LINES_CONSECUTIVE);
        }
        return Html.toHtml(text);
    }
}
