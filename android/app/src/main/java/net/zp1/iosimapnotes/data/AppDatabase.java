package net.zp1.iosimapnotes.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;

import java.util.ArrayList;
import java.util.List;

public final class AppDatabase extends SQLiteOpenHelper {
    private static final String NAME = "ios-imap-notes.db";
    private static final int VERSION = 1;

    public AppDatabase(Context context) {
        super(context.getApplicationContext(), NAME, null, VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE account ("
                + "id INTEGER PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, "
                + "security TEXT NOT NULL, username TEXT NOT NULL, mailbox TEXT NOT NULL)");
        db.execSQL("CREATE TABLE note ("
                + "id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, title TEXT NOT NULL, body_html TEXT NOT NULL, "
                + "updated_at INTEGER NOT NULL, mailbox TEXT NOT NULL, uid INTEGER NOT NULL, uid_validity INTEGER NOT NULL, "
                + "uuid TEXT NOT NULL, revision TEXT NOT NULL, created_date TEXT NOT NULL, from_address TEXT NOT NULL, "
                + "read_only INTEGER NOT NULL DEFAULT 0, unsupported_reason TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE INDEX note_account_date ON note(account_id, updated_at DESC)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unerwartete Datenbankversion " + oldVersion);
    }

    public synchronized Account getAccount() {
        try (Cursor cursor = getReadableDatabase().query(
                "account", null, "id = ?", new String[]{String.valueOf(Account.DEFAULT_ID)},
                null, null, null
        )) {
            if (!cursor.moveToFirst()) {
                return null;
            }
            Account account = new Account();
            account.id = cursor.getLong(cursor.getColumnIndexOrThrow("id"));
            account.name = cursor.getString(cursor.getColumnIndexOrThrow("name"));
            account.host = cursor.getString(cursor.getColumnIndexOrThrow("host"));
            account.port = cursor.getInt(cursor.getColumnIndexOrThrow("port"));
            account.security = cursor.getString(cursor.getColumnIndexOrThrow("security"));
            account.username = cursor.getString(cursor.getColumnIndexOrThrow("username"));
            account.mailbox = cursor.getString(cursor.getColumnIndexOrThrow("mailbox"));
            return account;
        }
    }

    public synchronized void saveAccount(Account account) {
        ContentValues values = new ContentValues();
        values.put("id", account.id);
        values.put("name", account.name);
        values.put("host", account.host);
        values.put("port", account.port);
        values.put("security", account.security);
        values.put("username", account.username);
        values.put("mailbox", account.mailbox);
        getWritableDatabase().insertWithOnConflict(
                "account", null, values, SQLiteDatabase.CONFLICT_REPLACE
        );
    }

    public synchronized List<Note> listNotes() {
        List<Note> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query(
                "note", null, null, null, null, null,
                "updated_at DESC, title COLLATE NOCASE ASC"
        )) {
            while (cursor.moveToNext()) {
                result.add(readNote(cursor));
            }
        }
        return result;
    }

    public synchronized Note getNote(String id) {
        try (Cursor cursor = getReadableDatabase().query(
                "note", null, "id = ?", new String[]{id}, null, null, null
        )) {
            return cursor.moveToFirst() ? readNote(cursor) : null;
        }
    }

    public synchronized void replaceNotes(long accountId, List<Note> notes) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("note", "account_id = ?", new String[]{String.valueOf(accountId)});
            for (Note note : notes) {
                db.insertWithOnConflict("note", null, noteValues(note), SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized void saveNote(Note note) {
        getWritableDatabase().insertWithOnConflict(
                "note", null, noteValues(note), SQLiteDatabase.CONFLICT_REPLACE
        );
    }

    public synchronized void deleteNote(String id) {
        getWritableDatabase().delete("note", "id = ?", new String[]{id});
    }

    private static ContentValues noteValues(Note note) {
        ContentValues values = new ContentValues();
        values.put("id", note.id);
        values.put("account_id", note.accountId);
        values.put("title", note.title);
        values.put("body_html", note.bodyHtml);
        values.put("updated_at", note.updatedAt);
        values.put("mailbox", note.mailbox);
        values.put("uid", note.uid);
        values.put("uid_validity", note.uidValidity);
        values.put("uuid", note.uuid);
        values.put("revision", note.revision);
        values.put("created_date", note.createdDate);
        values.put("from_address", note.fromAddress);
        values.put("read_only", note.readOnly ? 1 : 0);
        values.put("unsupported_reason", note.unsupportedReason);
        return values;
    }

    private static Note readNote(Cursor cursor) {
        Note note = new Note();
        note.id = cursor.getString(cursor.getColumnIndexOrThrow("id"));
        note.accountId = cursor.getLong(cursor.getColumnIndexOrThrow("account_id"));
        note.title = cursor.getString(cursor.getColumnIndexOrThrow("title"));
        note.bodyHtml = cursor.getString(cursor.getColumnIndexOrThrow("body_html"));
        note.updatedAt = cursor.getLong(cursor.getColumnIndexOrThrow("updated_at"));
        note.mailbox = cursor.getString(cursor.getColumnIndexOrThrow("mailbox"));
        note.uid = cursor.getLong(cursor.getColumnIndexOrThrow("uid"));
        note.uidValidity = cursor.getLong(cursor.getColumnIndexOrThrow("uid_validity"));
        note.uuid = cursor.getString(cursor.getColumnIndexOrThrow("uuid"));
        note.revision = cursor.getString(cursor.getColumnIndexOrThrow("revision"));
        note.createdDate = cursor.getString(cursor.getColumnIndexOrThrow("created_date"));
        note.fromAddress = cursor.getString(cursor.getColumnIndexOrThrow("from_address"));
        note.readOnly = cursor.getInt(cursor.getColumnIndexOrThrow("read_only")) != 0;
        note.unsupportedReason = cursor.getString(cursor.getColumnIndexOrThrow("unsupported_reason"));
        return note;
    }
}
