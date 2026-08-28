package net.zp1.iosimapnotes.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.data.AppDatabase;
import net.zp1.iosimapnotes.imap.ImapRepository;
import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.security.CredentialStore;

import java.util.List;

public final class AccountActivity extends Activity {
    public static final String EXTRA_ACCOUNT_ID = "account_id";

    private AppDatabase database;
    private CredentialStore credentialStore;
    private final ImapRepository repository = new ImapRepository();
    private EditText nameField;
    private EditText hostField;
    private EditText portField;
    private EditText usernameField;
    private EditText passwordField;
    private EditText mailboxField;
    private Spinner securitySpinner;
    private Spinner authenticationSpinner;
    private Button foldersButton;
    private Button saveButton;
    private Button deleteButton;
    private ProgressBar progress;
    private TextView status;
    private Account existing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_account);
        database = new AppDatabase(this);
        credentialStore = new CredentialStore(this);

        nameField = findViewById(R.id.nameField);
        hostField = findViewById(R.id.hostField);
        portField = findViewById(R.id.portField);
        usernameField = findViewById(R.id.usernameField);
        passwordField = findViewById(R.id.passwordField);
        mailboxField = findViewById(R.id.mailboxField);
        securitySpinner = findViewById(R.id.securitySpinner);
        authenticationSpinner = findViewById(R.id.authenticationSpinner);
        foldersButton = findViewById(R.id.foldersButton);
        saveButton = findViewById(R.id.saveButton);
        deleteButton = findViewById(R.id.deleteAccountButton);
        progress = findViewById(R.id.accountProgress);
        status = findViewById(R.id.accountStatus);

        securitySpinner.setAdapter(spinnerAdapter(R.array.security_modes));
        authenticationSpinner.setAdapter(spinnerAdapter(R.array.authentication_modes));

        long accountId = getIntent().getLongExtra(EXTRA_ACCOUNT_ID, 0L);
        existing = accountId > 0 ? database.getAccount(accountId) : null;
        if (existing != null) {
            nameField.setText(existing.name);
            hostField.setText(existing.host);
            portField.setText(String.valueOf(existing.port));
            usernameField.setText(existing.username);
            mailboxField.setText(existing.mailbox);
            securitySpinner.setSelection(existing.usesStartTls() ? 1 : 0);
            authenticationSpinner.setSelection(authenticationPosition(existing.authentication));
            deleteButton.setVisibility(View.VISIBLE);
        } else {
            nameField.setText(R.string.default_account_name);
            portField.setText(R.string.default_tls_port);
            mailboxField.setText(R.string.default_mailbox);
            deleteButton.setVisibility(View.GONE);
        }

        findViewById(R.id.backButton).setOnClickListener(view -> finish());
        foldersButton.setOnClickListener(view -> loadFolders());
        saveButton.setOnClickListener(view -> saveAndTest());
        deleteButton.setOnClickListener(view -> confirmDelete());
    }

    private ArrayAdapter<CharSequence> spinnerAdapter(int resource) {
        ArrayAdapter<CharSequence> adapter = ArrayAdapter.createFromResource(
                this, resource, android.R.layout.simple_spinner_item
        );
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private void loadFolders() {
        final Account account;
        final String password;
        try {
            account = readAccount();
            password = readPassword();
        } catch (Exception error) {
            showError(error);
            return;
        }
        setBusy(true, "Ordner werden geladen …");
        AppTasks.IO.execute(() -> {
            try {
                List<String> folders = repository.listFolders(account, password);
                runOnUiThread(() -> {
                    setBusy(false, folders.size() + " Ordner gefunden.");
                    new AlertDialog.Builder(this)
                            .setTitle("Notes-Ordner auswählen")
                            .setItems(folders.toArray(new String[0]), (dialog, which) ->
                                    mailboxField.setText(folders.get(which)))
                            .setNegativeButton("Abbrechen", null)
                            .show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, "Verbindung fehlgeschlagen.");
                    showError(error);
                });
            }
        });
    }

    private void saveAndTest() {
        final Account account;
        final String password;
        try {
            account = readAccount();
            password = readPassword();
        } catch (Exception error) {
            showError(error);
            return;
        }
        setBusy(true, "Verbindung, Authentifizierung und Ordner werden geprüft …");
        AppTasks.IO.execute(() -> {
            boolean newlyInserted = false;
            try {
                List<String> folders = repository.listFolders(account, password);
                if (!folders.contains(account.mailbox)) {
                    throw new IllegalArgumentException(
                            "Der Ordner „" + account.mailbox + "“ wurde auf dem Server nicht gefunden."
                    );
                }
                newlyInserted = account.id <= 0;
                database.saveAccount(account);
                try {
                    credentialStore.savePassword(account.id, password);
                } catch (Exception credentialError) {
                    if (newlyInserted) {
                        database.deleteAccount(account.id);
                    }
                    throw credentialError;
                }
                runOnUiThread(() -> {
                    setBusy(false, "Konto gespeichert.");
                    Toast.makeText(this, "Verbindung erfolgreich.", Toast.LENGTH_SHORT).show();
                    setResult(RESULT_OK);
                    finish();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false, "Konto wurde nicht gespeichert.");
                    showError(error);
                });
            }
        });
    }

    private Account readAccount() {
        Account account = new Account();
        if (existing != null) {
            account.id = existing.id;
        }
        account.name = required(nameField, "Kontoname");
        account.host = required(hostField, "IMAP-Server");
        account.username = required(usernameField, "Benutzername");
        account.mailbox = required(mailboxField, "Notes-Ordner");
        account.security = securitySpinner.getSelectedItemPosition() == 1
                ? Account.SECURITY_STARTTLS : Account.SECURITY_TLS;
        account.authentication = authenticationValue(authenticationSpinner.getSelectedItemPosition());
        String portText = required(portField, "Port");
        try {
            account.port = Integer.parseInt(portText);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Der Port muss eine Zahl sein.");
        }
        if (account.port < 1 || account.port > 65535) {
            throw new IllegalArgumentException("Der Port muss zwischen 1 und 65535 liegen.");
        }
        return account;
    }

    private String readPassword() throws Exception {
        String entered = passwordField.getText().toString();
        if (!entered.isEmpty()) {
            return entered;
        }
        String stored = existing == null ? "" : credentialStore.getPassword(existing.id);
        if (stored.isEmpty()) {
            throw new IllegalArgumentException("Bitte das Passwort oder App-Passwort eingeben.");
        }
        return stored;
    }

    private void confirmDelete() {
        if (existing == null) {
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("IMAP-Konto löschen?")
                .setMessage("Das Konto und sein Offline-Cache werden aus der App entfernt. Die Notizen auf dem IMAP-Server bleiben erhalten.")
                .setPositiveButton("Konto löschen", (dialog, which) -> {
                    credentialStore.clear(existing.id);
                    database.deleteAccount(existing.id);
                    setResult(RESULT_OK);
                    finish();
                })
                .setNegativeButton("Abbrechen", null)
                .show();
    }

    private static String required(EditText field, String label) {
        String value = field.getText().toString().trim();
        if (value.isEmpty()) {
            field.requestFocus();
            throw new IllegalArgumentException(label + " fehlt.");
        }
        return value;
    }

    private static int authenticationPosition(String value) {
        if (Account.AUTH_CRAM_MD5.equals(value)) return 1;
        if (Account.AUTH_PLAIN.equals(value)) return 2;
        if (Account.AUTH_LOGIN.equals(value)) return 3;
        return 0;
    }

    private static String authenticationValue(int position) {
        if (position == 1) return Account.AUTH_CRAM_MD5;
        if (position == 2) return Account.AUTH_PLAIN;
        if (position == 3) return Account.AUTH_LOGIN;
        return Account.AUTH_AUTO;
    }

    private void setBusy(boolean busy, String message) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        foldersButton.setEnabled(!busy);
        saveButton.setEnabled(!busy);
        deleteButton.setEnabled(!busy);
        status.setText(message);
    }

    private void showError(Throwable error) {
        Toast.makeText(this, UiErrors.message(error), Toast.LENGTH_LONG).show();
    }
}
