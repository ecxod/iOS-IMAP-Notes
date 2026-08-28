package net.zp1.iosimapnotes.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

public final class UpdateInstallReceiver extends BroadcastReceiver {
    public static final String ACTION_INSTALL_RESULT =
            "net.zp1.iosimapnotes.action.UPDATE_INSTALL_RESULT";

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(
                PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE
        );
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation != null) {
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirmation);
            }
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(context, "iOS IMAP Notes wurde aktualisiert.", Toast.LENGTH_LONG).show();
            return;
        }
        String detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Toast.makeText(
                context,
                "Update konnte nicht installiert werden" + (detail == null ? "." : ": " + detail),
                Toast.LENGTH_LONG
        ).show();
    }
}
