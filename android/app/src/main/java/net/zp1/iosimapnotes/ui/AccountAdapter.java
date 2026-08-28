package net.zp1.iosimapnotes.ui;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.TextView;

import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.model.Account;

import java.util.ArrayList;
import java.util.List;

final class AccountAdapter extends BaseAdapter {
    private final Context context;
    private final LayoutInflater inflater;
    private final List<Account> accounts = new ArrayList<>();

    AccountAdapter(Context context) {
        this.context = context;
        inflater = LayoutInflater.from(context);
    }

    void replace(List<Account> values) {
        accounts.clear();
        accounts.addAll(values);
        notifyDataSetChanged();
    }

    @Override public int getCount() { return accounts.size(); }
    @Override public Account getItem(int position) { return accounts.get(position); }
    @Override public long getItemId(int position) { return accounts.get(position).id; }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        Holder holder;
        if (convertView == null) {
            convertView = inflater.inflate(R.layout.account_row, parent, false);
            holder = new Holder();
            holder.name = convertView.findViewById(R.id.accountRowName);
            holder.details = convertView.findViewById(R.id.accountRowDetails);
            convertView.setTag(holder);
        } else {
            holder = (Holder) convertView.getTag();
        }
        Account account = getItem(position);
        holder.name.setText(account.name);
        holder.details.setText(context.getString(
                R.string.account_details,
                account.username,
                account.host,
                account.mailbox,
                authenticationLabel(account.authentication)
        ));
        return convertView;
    }

    static String authenticationLabel(String value) {
        if (Account.AUTH_CRAM_MD5.equals(value)) return "CRAM-MD5";
        if (Account.AUTH_PLAIN.equals(value)) return "PLAIN";
        if (Account.AUTH_LOGIN.equals(value)) return "LOGIN";
        return "Automatisch";
    }

    private static final class Holder {
        TextView name;
        TextView details;
    }
}
