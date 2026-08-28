package net.zp1.iosimapnotes.ui;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.TextView;

import net.zp1.iosimapnotes.R;
import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class NoteAdapter extends BaseAdapter {
    private final LayoutInflater inflater;
    private final DateFormat dateFormat;
    private final List<Note> notes = new ArrayList<>();
    private final Map<Long, String> accountNames = new HashMap<>();

    NoteAdapter(Context context) {
        inflater = LayoutInflater.from(context);
        dateFormat = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);
    }

    void setAccounts(List<Account> accounts) {
        accountNames.clear();
        for (Account account : accounts) {
            accountNames.put(account.id, account.name);
        }
        notifyDataSetChanged();
    }

    void replace(List<Note> values) {
        notes.clear();
        notes.addAll(values);
        notifyDataSetChanged();
    }

    @Override
    public int getCount() {
        return notes.size();
    }

    @Override
    public Note getItem(int position) {
        return notes.get(position);
    }

    @Override
    public long getItemId(int position) {
        return notes.get(position).id.hashCode();
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        Holder holder;
        if (convertView == null) {
            convertView = inflater.inflate(R.layout.note_row, parent, false);
            holder = new Holder();
            holder.title = convertView.findViewById(R.id.noteTitle);
            holder.meta = convertView.findViewById(R.id.noteMeta);
            convertView.setTag(holder);
        } else {
            holder = (Holder) convertView.getTag();
        }
        Note note = getItem(position);
        holder.title.setText(note.title);
        String accountName = accountNames.get(note.accountId);
        StringBuilder meta = new StringBuilder(dateFormat.format(new Date(note.updatedAt)));
        if (accountName != null && !accountName.isEmpty()) {
            meta.append(" · ").append(accountName);
        }
        if (note.readOnly) {
            meta.append(" · schreibgeschützt");
        }
        holder.meta.setText(meta.toString());
        return convertView;
    }

    private static final class Holder {
        TextView title;
        TextView meta;
    }
}
