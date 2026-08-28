package net.zp1.iosimapnotes.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.Html;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.data.AppDatabase;
import net.zp1.iosimapnotes.imap.ImapRepository;
import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;
import net.zp1.iosimapnotes.security.CredentialStore;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int REQUEST_ACCOUNT = 42;
    private AppDatabase database;
    private CredentialStore credentialStore;
    private final ImapRepository repository = new ImapRepository();
    private final List<Note> allNotes = new ArrayList<>();
    private NoteAdapter adapter;
    private ProgressBar progress;
    private TextView status;
    private EditText search;
    private Button addButton;
    private Button syncButton;
    private boolean firstResume = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        database = new AppDatabase(this);
        credentialStore = new CredentialStore(this);
        adapter = new NoteAdapter(this);

        progress = findViewById(R.id.progress);
        status = findViewById(R.id.statusText);
        search = findViewById(R.id.searchField);
        addButton = findViewById(R.id.addButton);
        syncButton = findViewById(R.id.syncButton);
        ListView list = findViewById(R.id.noteList);
        list.setAdapter(adapter);
        list.setEmptyView(findViewById(R.id.emptyText));
        list.setOnItemClickListener((parent, view, position, id) -> {
            Intent intent = new Intent(this, EditorActivity.class);
            intent.putExtra(EditorActivity.EXTRA_NOTE_ID, adapter.getItem(position).id);
            startActivity(intent);
        });

        addButton.setOnClickListener(view -> startActivity(new Intent(this, EditorActivity.class)));
        syncButton.setOnClickListener(view -> synchronize());
        findViewById(R.id.settingsButton).setOnClickListener(
                view -> startActivityForResult(new Intent(this, AccountActivity.class), REQUEST_ACCOUNT)
        );
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { filter(); }
            @Override public void afterTextChanged(Editable s) { }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadCache();
        Account account = database.getAccount();
        addButton.setEnabled(account != null);
        syncButton.setEnabled(account != null);
        if (account == null) {
            status.setText("Bitte zuerst ein IMAP-Konto einrichten.");
            if (firstResume) {
                startActivityForResult(new Intent(this, AccountActivity.class), REQUEST_ACCOUNT);
            }
        } else if (firstResume && allNotes.isEmpty()) {
            synchronize();
        }
        firstResume = false;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_ACCOUNT && resultCode == RESULT_OK) {
            synchronize();
        }
    }

    private void loadCache() {
        allNotes.clear();
        allNotes.addAll(database.listNotes());
        filter();
    }

    private void filter() {
        String query = search == null ? "" : search.getText().toString()
                .toLowerCase(Locale.getDefault()).trim();
        if (query.isEmpty()) {
            adapter.replace(allNotes);
            return;
        }
        List<Note> filtered = new ArrayList<>();
        for (Note note : allNotes) {
            String text = note.title + " " + plainText(note.bodyHtml);
            if (text.toLowerCase(Locale.getDefault()).contains(query)) {
                filtered.add(note);
            }
        }
        adapter.replace(filtered);
    }

    @SuppressWarnings("deprecation")
    private static String plainText(String html) {
        if (android.os.Build.VERSION.SDK_INT >= 24) {
            return Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString();
        }
        return Html.fromHtml(html).toString();
    }

    private void synchronize() {
        Account account = database.getAccount();
        if (account == null) {
            startActivityForResult(new Intent(this, AccountActivity.class), REQUEST_ACCOUNT);
            return;
        }
        setBusy(true, "Synchronisierung läuft …");
        AppTasks.IO.execute(() -> {
            try {
                String password = credentialStore.getPassword();
                List<Note> notes = repository.synchronize(account, password);
                database.replaceNotes(account.id, notes);
                runOnUiThread(() -> {
                    setBusy(false, notes.size() + " Notizen synchronisiert.");
                    loadCache();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, "Offline-Cache · Synchronisierung fehlgeschlagen");
                    Toast.makeText(this, UiErrors.message(error), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void setBusy(boolean busy, String message) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        syncButton.setEnabled(!busy && database.getAccount() != null);
        addButton.setEnabled(!busy && database.getAccount() != null);
        status.setText(message);
    }
}
