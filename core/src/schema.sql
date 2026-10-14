CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 source TEXT NOT NULL, raw_text TEXT, search_uni TEXT, summary TEXT, tags TEXT,
 entities TEXT, audio_path TEXT, duration_ms INTEGER DEFAULT 0, language TEXT,
 process_state TEXT DEFAULT 'pending', device_id TEXT, rev INTEGER DEFAULT 1,
 deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(deleted,created_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_trigram USING fts5(raw_text,summary,tags,content='notes',content_rowid='rowid',tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_unigram USING fts5(search_uni,content='notes',content_rowid='rowid',tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
 INSERT INTO notes_fts_trigram(rowid,raw_text,summary,tags) VALUES(new.rowid,new.raw_text,new.summary,new.tags);
 INSERT INTO notes_fts_unigram(rowid,search_uni) VALUES(new.rowid,new.search_uni);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
 INSERT INTO notes_fts_trigram(notes_fts_trigram,rowid,raw_text,summary,tags) VALUES('delete',old.rowid,old.raw_text,old.summary,old.tags);
 INSERT INTO notes_fts_unigram(notes_fts_unigram,rowid,search_uni) VALUES('delete',old.rowid,old.search_uni);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
 INSERT INTO notes_fts_trigram(notes_fts_trigram,rowid,raw_text,summary,tags) VALUES('delete',old.rowid,old.raw_text,old.summary,old.tags);
 INSERT INTO notes_fts_trigram(rowid,raw_text,summary,tags) VALUES(new.rowid,new.raw_text,new.summary,new.tags);
 INSERT INTO notes_fts_unigram(notes_fts_unigram,rowid,search_uni) VALUES('delete',old.rowid,old.search_uni);
 INSERT INTO notes_fts_unigram(rowid,search_uni) VALUES(new.rowid,new.search_uni);
END;
CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO app_meta VALUES('remote_apply','0');
CREATE TABLE IF NOT EXISTS sync_outbox(note_id TEXT PRIMARY KEY,op_id TEXT NOT NULL,local_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sync_versions(note_id TEXT PRIMARY KEY,server_rev INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sync_conflicts(note_id TEXT PRIMARY KEY,remote_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY,note_id TEXT NOT NULL,kind TEXT NOT NULL,provider_id TEXT NOT NULL,note_rev INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,started_at INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS ai_job_unique ON ai_jobs(note_id,kind,note_rev,provider_id);
CREATE TRIGGER IF NOT EXISTS notes_sync_insert AFTER INSERT ON notes
 WHEN (SELECT value FROM app_meta WHERE key='remote_apply')='0'
 BEGIN INSERT INTO sync_outbox VALUES(new.id,lower(hex(randomblob(16))),new.rev)
 ON CONFLICT(note_id) DO UPDATE SET op_id=excluded.op_id,local_rev=excluded.local_rev; END;
CREATE TRIGGER IF NOT EXISTS notes_sync_update AFTER UPDATE ON notes
 WHEN (SELECT value FROM app_meta WHERE key='remote_apply')='0' AND new.rev!=old.rev
 BEGIN INSERT INTO sync_outbox VALUES(new.id,lower(hex(randomblob(16))),new.rev)
 ON CONFLICT(note_id) DO UPDATE SET op_id=excluded.op_id,local_rev=excluded.local_rev; END;
