package net.zp1.iosimapnotes.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;

import net.zp1.iosimapnotes.BuildConfig;
import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.data.AppDatabase;
import net.zp1.iosimapnotes.update.UpdateManager;

public final class PropertiesActivity extends Activity {
    private static final int REQUEST_ACCOUNT = 51;

    private AppDatabase database;
    private AccountAdapter adapter;
    private boolean firstResume = true;
    private Button updateButton;
    private ProgressBar updateProgress;
    private TextView updateStatus;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_properties);
        database = new AppDatabase(this);
        adapter = new AccountAdapter(this);

        ListView accountList = findViewById(R.id.accountList);
        accountList.setAdapter(adapter);
        accountList.setEmptyView(findViewById(R.id.noAccountsText));
        accountList.setOnItemClickListener((parent, view, position, id) ->
                editAccount(adapter.getItem(position).id));

        findViewById(R.id.propertiesBackButton).setOnClickListener(view -> finish());
        findViewById(R.id.addAccountButton).setOnClickListener(view -> editAccount(0L));
        updateButton = findViewById(R.id.updateButton);
        updateProgress = findViewById(R.id.updateProgress);
        updateStatus = findViewById(R.id.updateStatus);
        ((TextView) findViewById(R.id.currentVersionText)).setText(
                getString(R.string.current_version, BuildConfig.VERSION_NAME)
        );
        updateButton.setOnClickListener(view -> checkForUpdate());
    }

    @Override
    protected void onResume() {
        super.onResume();
        adapter.replace(database.listAccounts());
        if (firstResume && adapter.getCount() == 0) {
            editAccount(0L);
        }
        firstResume = false;
    }

    private void editAccount(long accountId) {
        Intent intent = new Intent(this, AccountActivity.class);
        if (accountId > 0) {
            intent.putExtra(AccountActivity.EXTRA_ACCOUNT_ID, accountId);
        }
        startActivityForResult(intent, REQUEST_ACCOUNT);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_ACCOUNT && resultCode == RESULT_OK) {
            adapter.replace(database.listAccounts());
            setResult(RESULT_OK);
        }
    }

    private void checkForUpdate() {
        setUpdateBusy(true, "GitHub wird nach einer neuen Android-Version durchsucht …");
        UpdateManager.checkAndInstall(this, new UpdateManager.Listener() {
            @Override
            public void onStatus(String message) {
                runOnUiThread(() -> updateStatus.setText(message));
            }

            @Override
            public void onComplete(String message) {
                runOnUiThread(() -> setUpdateBusy(false, message));
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> setUpdateBusy(false, "Update fehlgeschlagen: " + message));
            }
        });
    }

    private void setUpdateBusy(boolean busy, String message) {
        updateButton.setEnabled(!busy);
        updateProgress.setVisibility(busy ? View.VISIBLE : View.GONE);
        updateStatus.setText(message);
    }
}
