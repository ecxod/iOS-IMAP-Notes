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
    private Button foldersButton;
    private Button saveButton;
    private ProgressBar progress;
    private TextView status;

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
        foldersButton = findViewById(R.id.foldersButton);
        saveButton = findViewById(R.id.saveButton);
        progress = findViewById(R.id.accountProgress);
        status = findViewById(R.id.accountStatus);

        ArrayAdapter<CharSequence> securityAdapter = ArrayAdapter.createFromResource(
                this, R.array.security_modes, android.R.layout.simple_spinner_item
        );
        securityAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        securitySpinner.setAdapter(securityAdapter);

        Account existing = database.getAccount();
        if (existing != null) {
            nameField.setText(existing.name);
            hostField.setText(existing.host);
            portField.setText(String.valueOf(existing.port));
            usernameField.setText(existing.username);
            mailboxField.setText(existing.mailbox);
            securitySpinner.setSelection(existing.usesStartTls() ? 1 : 0);
        } else {
            nameField.setText("Meine Notizen");
            portField.setText("993");
            mailboxField.setText("Notes");
        }

        findViewById(R.id.backButton).setOnClickListener(view -> finish());
        foldersButton.setOnClickListener(view -> loadFolders());
        saveButton.setOnClickListener(view -> saveAndTest());
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
        setBusy(true, "Verbindung und Ordner werden geprüft …");
        AppTasks.IO.execute(() -> {
            try {
                List<String> folders = repository.listFolders(account, password);
                if (!folders.contains(account.mailbox)) {
                    throw new IllegalArgumentException(
                            "Der Ordner „" + account.mailbox + "“ wurde auf dem Server nicht gefunden."
                    );
                }
                credentialStore.savePassword(password);
                database.saveAccount(account);
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
        account.name = required(nameField, "Kontoname");
        account.host = required(hostField, "IMAP-Server");
        account.username = required(usernameField, "Benutzername");
        account.mailbox = required(mailboxField, "Notes-Ordner");
        account.security = securitySpinner.getSelectedItemPosition() == 1
                ? Account.SECURITY_STARTTLS : Account.SECURITY_TLS;
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
        String stored = credentialStore.getPassword();
        if (stored.isEmpty()) {
            throw new IllegalArgumentException("Bitte das Passwort oder App-Passwort eingeben.");
        }
        return stored;
    }

    private static String required(EditText field, String label) {
        String value = field.getText().toString().trim();
        if (value.isEmpty()) {
            field.requestFocus();
            throw new IllegalArgumentException(label + " fehlt.");
        }
        return value;
    }

    private void setBusy(boolean busy, String message) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        foldersButton.setEnabled(!busy);
        saveButton.setEnabled(!busy);
        status.setText(message);
    }

    private void showError(Throwable error) {
        Toast.makeText(this, UiErrors.message(error), Toast.LENGTH_LONG).show();
    }
}
