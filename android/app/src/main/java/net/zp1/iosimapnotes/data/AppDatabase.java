package net.zp1.iosimapnotes.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import net.zp1.iosimapnotes.model.Account;
import net.zp1.iosimapnotes.model.Note;
import net.zp1.iosimapnotes.model.NoteImage;

import java.util.ArrayList;
import java.util.List;

public final class AppDatabase extends SQLiteOpenHelper {
    private static final String NAME = "ios-imap-notes.db";
    private static final int VERSION = 3;

    public AppDatabase(Context context) {
        super(context.getApplicationContext(), NAME, null, VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE account ("
                + "id INTEGER PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, "
                + "security TEXT NOT NULL, authentication TEXT NOT NULL DEFAULT 'auto', "
                + "username TEXT NOT NULL, mailbox TEXT NOT NULL)");
        db.execSQL("CREATE TABLE note ("
                + "id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, title TEXT NOT NULL, body_html TEXT NOT NULL, "
                + "updated_at INTEGER NOT NULL, mailbox TEXT NOT NULL, uid INTEGER NOT NULL, uid_validity INTEGER NOT NULL, "
                + "uuid TEXT NOT NULL, revision TEXT NOT NULL, created_date TEXT NOT NULL, from_address TEXT NOT NULL, "
                + "read_only INTEGER NOT NULL DEFAULT 0, unsupported_reason TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE INDEX note_account_date ON note(account_id, updated_at DESC)");
        createNoteImageTable(db);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE account ADD COLUMN authentication TEXT NOT NULL DEFAULT 'auto'");
        }
        if (oldVersion < 3) {
            createNoteImageTable(db);
        }
    }

    private static void createNoteImageTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS note_image ("
                + "note_id TEXT NOT NULL, content_id TEXT NOT NULL COLLATE NOCASE, "
                + "content_type TEXT NOT NULL, filename TEXT NOT NULL, data BLOB NOT NULL, "
                + "PRIMARY KEY(note_id, content_id))");
        db.execSQL("CREATE INDEX IF NOT EXISTS note_image_note ON note_image(note_id)");
    }

    public synchronized Account getAccount(long id) {
        try (Cursor cursor = getReadableDatabase().query(
                "account", null, "id = ?", new String[]{String.valueOf(id)},
                null, null, null
        )) {
            if (!cursor.moveToFirst()) {
                return null;
            }
            return readAccount(cursor);
        }
    }

    public synchronized List<Account> listAccounts() {
        List<Account> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query(
                "account", null, null, null, null, null, "name COLLATE NOCASE ASC, id ASC"
        )) {
            while (cursor.moveToNext()) {
                result.add(readAccount(cursor));
            }
        }
        return result;
    }

    public synchronized long saveAccount(Account account) {
        ContentValues values = new ContentValues();
        if (account.id > 0) {
            values.put("id", account.id);
        }
        values.put("name", account.name);
        values.put("host", account.host);
        values.put("port", account.port);
        values.put("security", account.security);
        values.put("authentication", account.authentication);
        values.put("username", account.username);
        values.put("mailbox", account.mailbox);
        long id = getWritableDatabase().insertWithOnConflict(
                "account", null, values, SQLiteDatabase.CONFLICT_REPLACE
        );
        if (id < 0) {
            throw new IllegalStateException("Das IMAP-Konto konnte nicht gespeichert werden.");
        }
        account.id = id;
        return id;
    }

    public synchronized void deleteAccount(long accountId) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("note_image", "note_id IN (SELECT id FROM note WHERE account_id = ?)",
                    new String[]{String.valueOf(accountId)});
            db.delete("note", "account_id = ?", new String[]{String.valueOf(accountId)});
            db.delete("account", "id = ?", new String[]{String.valueOf(accountId)});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
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
            db.delete("note_image", "note_id IN (SELECT id FROM note WHERE account_id = ?)",
                    new String[]{String.valueOf(accountId)});
            db.delete("note", "account_id = ?", new String[]{String.valueOf(accountId)});
            for (Note note : notes) {
                saveNoteRecord(db, note);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized void saveNote(Note note) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            saveNoteRecord(db, note);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized void deleteNote(String id) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("note_image", "note_id = ?", new String[]{id});
            db.delete("note", "id = ?", new String[]{id});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private static void saveNoteRecord(SQLiteDatabase db, Note note) {
        long inserted = db.insertWithOnConflict(
                "note", null, noteValues(note), SQLiteDatabase.CONFLICT_REPLACE
        );
        if (inserted < 0) {
            throw new IllegalStateException("Die Notiz konnte nicht lokal gespeichert werden.");
        }
        db.delete("note_image", "note_id = ?", new String[]{note.id});
        for (NoteImage image : note.images) {
            ContentValues values = new ContentValues();
            values.put("note_id", note.id);
            values.put("content_id", image.contentId);
            values.put("content_type", image.contentType);
            values.put("filename", image.filename);
            values.put("data", image.data);
            if (db.insertWithOnConflict(
                    "note_image", null, values, SQLiteDatabase.CONFLICT_REPLACE
            ) < 0) {
                throw new IllegalStateException("Ein Notizbild konnte nicht lokal gespeichert werden.");
            }
        }
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

    private static Account readAccount(Cursor cursor) {
        Account account = new Account();
        account.id = cursor.getLong(cursor.getColumnIndexOrThrow("id"));
        account.name = cursor.getString(cursor.getColumnIndexOrThrow("name"));
        account.host = cursor.getString(cursor.getColumnIndexOrThrow("host"));
        account.port = cursor.getInt(cursor.getColumnIndexOrThrow("port"));
        account.security = cursor.getString(cursor.getColumnIndexOrThrow("security"));
        account.authentication = cursor.getString(cursor.getColumnIndexOrThrow("authentication"));
        account.username = cursor.getString(cursor.getColumnIndexOrThrow("username"));
        account.mailbox = cursor.getString(cursor.getColumnIndexOrThrow("mailbox"));
        return account;
    }

    private Note readNote(Cursor cursor) {
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
        try (Cursor images = getReadableDatabase().query(
                "note_image", null, "note_id = ?", new String[]{note.id},
                null, null, "rowid ASC"
        )) {
            while (images.moveToNext()) {
                note.images.add(new NoteImage(
                        images.getString(images.getColumnIndexOrThrow("content_id")),
                        images.getString(images.getColumnIndexOrThrow("content_type")),
                        images.getString(images.getColumnIndexOrThrow("filename")),
                        images.getBlob(images.getColumnIndexOrThrow("data"))
                ));
            }
        }
        return note;
    }
}
