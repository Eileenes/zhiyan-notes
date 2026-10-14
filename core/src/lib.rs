//! Shared local data, provider protocols and sync engine. No credentials are persisted here.
pub mod gateway;
mod model;
mod sync;
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};
use std::{
    ffi::{CStr, CString},
    os::raw::c_char,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn num(v: &Value, key: &str) -> i64 {
    v[key].as_i64().unwrap_or(0)
}
fn parsed(v: String) -> Value {
    serde_json::from_str(&v).unwrap_or(Value::Null)
}

pub struct Core {
    pub db: Connection,
    pub path: PathBuf,
}
impl Core {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        let db = Connection::open(&path)?;
        db.busy_timeout(Duration::from_secs(10))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        db.execute_batch("BEGIN IMMEDIATE")?;
        db.execute_batch(include_str!("schema.sql"))?;
        let columns: Vec<String> = db
            .prepare("PRAGMA table_info(notes)")?
            .query_map([], |r| r.get(1))?
            .collect::<rusqlite::Result<_>>()?;
        for (name, kind) in [
            ("transcript", "TEXT"),
            ("ai_tags", "TEXT DEFAULT '[]'"),
            ("attachment_id", "TEXT"),
            ("ai_status", "TEXT DEFAULT ''"),
        ] {
            if !columns.iter().any(|c| c == name) {
                db.execute_batch(&format!("ALTER TABLE notes ADD COLUMN {name} {kind}"))?;
            }
        }
        let existed: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='notes_fts_ai')",
            [],
            |r| r.get(0),
        )?;
        db.execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts_ai USING fts5(transcript,ai_tags,content='notes',content_rowid='rowid',tokenize='trigram');
        CREATE TRIGGER IF NOT EXISTS notes_ai_extra AFTER INSERT ON notes BEGIN INSERT INTO notes_fts_ai(rowid,transcript,ai_tags) VALUES(new.rowid,new.transcript,new.ai_tags); END;
        CREATE TRIGGER IF NOT EXISTS notes_ad_extra AFTER DELETE ON notes BEGIN INSERT INTO notes_fts_ai(notes_fts_ai,rowid,transcript,ai_tags) VALUES('delete',old.rowid,old.transcript,old.ai_tags); END;
        CREATE TRIGGER IF NOT EXISTS notes_au_extra AFTER UPDATE ON notes BEGIN INSERT INTO notes_fts_ai(notes_fts_ai,rowid,transcript,ai_tags) VALUES('delete',old.rowid,old.transcript,old.ai_tags); INSERT INTO notes_fts_ai(rowid,transcript,ai_tags) VALUES(new.rowid,new.transcript,new.ai_tags); END;")?;
        if !existed {
            db.execute_batch("INSERT INTO notes_fts_ai(notes_fts_ai) VALUES('rebuild')")?;
        }
        // iOS changes the app container path during upgrades. Rebind only files present
        // in this database's own media directory; never import an external path.
        let media = path.parent().unwrap().join("media");
        let root = media.to_string_lossy().to_string();
        let previous: Option<String> = db
            .query_row(
                "SELECT value FROM app_meta WHERE key='media_root'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if previous.as_deref() != Some(&root) {
            let audio = db
                .prepare("SELECT id,audio_path FROM notes WHERE audio_path IS NOT NULL")?
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for (id, old) in audio {
                if let Some(name) = Path::new(&old).file_name() {
                    let local = media.join(name);
                    if local.is_file() {
                        db.execute(
                            "UPDATE notes SET audio_path=? WHERE id=?",
                            params![local.to_string_lossy().as_ref(), id],
                        )?;
                    }
                }
            }
            db.execute("INSERT INTO app_meta VALUES('media_root',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[root])?;
        }
        db.execute_batch("COMMIT")?;
        Ok(Self { db, path })
    }
    pub fn media(&self) -> Result<PathBuf> {
        let p = self.path.parent().unwrap().join("media");
        std::fs::create_dir_all(&p)?;
        Ok(p)
    }
    pub fn meta(&self, key: &str) -> Result<Value> {
        Ok(self
            .db
            .query_row("SELECT value FROM app_meta WHERE key=?", [key], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .map(parsed)
            .unwrap_or(Value::Null))
    }
    pub fn set_meta(&self, key: &str, value: &Value) -> Result<()> {
        self.db.execute(
            "INSERT INTO app_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value.to_string()],
        )?;
        Ok(())
    }
    pub fn get(&self, id: &str, deleted: bool) -> Result<Option<Value>> {
        Ok(self
            .db
            .query_row(
                "SELECT * FROM notes WHERE id=? AND (? OR deleted=0)",
                params![id, deleted],
                note,
            )
            .optional()?)
    }
    pub fn notes(&self) -> Result<Vec<Value>> {
        Ok(self
            .db
            .prepare("SELECT * FROM notes ORDER BY created_at DESC,id DESC")?
            .query_map([], note)?
            .collect::<rusqlite::Result<_>>()?)
    }
    pub fn stats(&self) -> Result<Value> {
        Ok(self.db.query_row("SELECT count(*),sum(audio_path IS NOT NULL OR attachment_id IS NOT NULL),sum(process_state='pending') FROM notes WHERE deleted=0",[],|r|Ok(json!({"total":r.get::<_,i64>(0)?,"with_audio":r.get::<_,Option<i64>>(1)?.unwrap_or(0),"pending":r.get::<_,Option<i64>>(2)?.unwrap_or(0)})))?)
    }
    pub fn call(&mut self, m: Value) -> Result<Value> {
        match s(&m, "op") {
            "gatewayStatus" => gateway::status(self),
            "gatewayStart" => gateway::start(self, &m),
            "gatewayStop" => gateway::stop(self),
            "gatewayRotate" => gateway::rotate(self, s(&m, "key")),
            "deviceID" => {
                let mut id = self.meta("device_id")?;
                if id.is_null() {
                    id = json!(Uuid::new_v4().to_string());
                    self.set_meta("device_id", &id)?;
                }
                Ok(id)
            }
            "providersValidate" => {
                let providers = m["providers"].as_array().ok_or("服务配置格式错误")?;
                for p in providers {
                    model::validate_provider(p)?;
                }
                Ok(json!(true))
            }
            "servicesGet" => Ok(
                json!({"providers":self.meta("providers")?.as_array().cloned().unwrap_or_default(),"sync":self.sync_status()?,"jobs":self.jobs()?}),
            ),
            "providersSave" => {
                let providers = m["providers"].as_array().ok_or("服务配置格式错误")?;
                if providers.len() > 30 {
                    return Err("最多保存 30 个服务配置".into());
                }
                let clean: Vec<Value> = providers
                    .iter()
                    .map(model::validate_provider)
                    .collect::<Result<_>>()?;
                self.set_meta("providers", &json!(clean))?;
                Ok(json!(clean))
            }
            "providerTest" => model::test(&m["provider"], s(&m, "key")),
            "aiEnqueue" => self.enqueue(&m),
            "aiRun" => self.process_job(&m),
            "aiRetry" => {
                self.db.execute("UPDATE ai_jobs SET status='pending',error='' WHERE id=? AND status IN ('failed','stale')",[s(&m,"id")])?;
                Ok(json!(true))
            }
            "syncAuth" => sync::auth(&m),
            "syncBind" => self.bind(&m),
            "syncRun" => self.sync_run(s(&m, "token")),
            "syncLogout" => {
                self.set_meta("sync_enabled", &json!(false))?;
                let revoked = sync::logout(&self.meta("sync_account")?, s(&m, "token")).is_ok();
                Ok(json!({"revoked":revoked}))
            }
            "syncStatus" => self.sync_status(),
            "syncConflicts" => Ok(json!(self.conflicts()?)),
            "syncResolve" => self.resolve(&m),
            "audioDownload" => self.download_audio(s(&m, "id"), s(&m, "token")),
            "load" => Ok(
                json!({"notes":self.notes()?.into_iter().filter(|n|n["deleted"]!=true).take(2000).collect::<Vec<_>>(),"stats":self.stats()?}),
            ),
            "page" => {
                let items = self.db.prepare("SELECT * FROM notes WHERE deleted=0 AND (? OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 50")?.query_map(params![m["before"].is_null(),num(&m,"before"),num(&m,"before"),s(&m,"beforeID")], note)?.collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(json!({"notes":items,"stats":self.stats()?}))
            }
            "get" => self
                .get(s(&m, "id"), false)?
                .ok_or("这条记忆已不存在".into()),
            "stats" => self.stats(),
            "search" => {
                let hits = self.search(s(&m, "q"), s(&m, "source"))?;
                Ok(json!({"count":hits.len(),"hits":hits}))
            }
            "save" => {
                let id = if s(&m, "id").is_empty() {
                    Uuid::new_v4().to_string()
                } else {
                    s(&m, "id").to_string()
                };
                let old = self.get(&id, true)?;
                let mut n = json!({"id":id,"created_at":old.as_ref().map(|n|num(n,"created_at")).unwrap_or_else(now),"updated_at":now(),"raw":s(&m,"text"),"source":if s(&m,"source").is_empty(){"text"}else{s(&m,"source")},"summary":m["summary"],"tags":m["tags"].as_array().cloned().unwrap_or_default(),"audio":m["audio"],"dur":m["dur"].as_f64().unwrap_or(0.0)/1000.0,"state":if s(&m,"state").is_empty(){"done"}else{s(&m,"state")},"rev":old.as_ref().map(|n|num(n,"rev")+1).unwrap_or(1),"deleted":false});
                if let Some(p) = n["audio"].as_str() {
                    n["audio"] = json!(self.checked_media(p)?.to_string_lossy());
                }
                self.put(&n)?;
                Ok(json!({"id":id,"stats":self.stats()?}))
            }
            "update" => {
                let mut n = self.get(s(&m, "id"), false)?.ok_or("这条记忆已不存在")?;
                n["raw"] = m["text"].clone();
                n["tags"] = m["tags"].clone();
                n["summary"] = Value::Null;
                n["ai_tags"] = json!([]);
                n["rev"] = json!(num(&n, "rev") + 1);
                n["updated_at"] = json!(now());
                self.put(&n)?;
                Ok(json!(true))
            }
            "delete" | "restore" => {
                self.db.execute(
                    "UPDATE notes SET deleted=?,rev=rev+1,updated_at=? WHERE id=?",
                    params![s(&m, "op") == "delete", now(), s(&m, "id")],
                )?;
                Ok(self.stats()?)
            }
            "prefsGet" => Ok(self
                .meta("preferences")?
                .as_object()
                .cloned()
                .map(Value::Object)
                .unwrap_or(json!({}))),
            "prefsSet" => {
                if !["draft", "theme", "sidebar", "recordingDraft", "onboarded", "aiConsent"]
                    .contains(&s(&m, "key"))
                {
                    return Err("无效的设置".into());
                }
                let mut v = self.meta("preferences")?;
                if !v.is_object() {
                    v = json!({});
                }
                v[s(&m, "key")] = m["value"].clone();
                self.set_meta("preferences", &v)?;
                Ok(json!(true))
            }
            "export" => self.export(&m),
            "mediaWrite" => {
                use base64::Engine;
                let data = base64::engine::general_purpose::STANDARD.decode(s(&m, "data"))?;
                if data.len() > 100 * 1024 * 1024 {
                    return Err("录音文件过大".into());
                }
                let ext = match s(&m, "format") {
                    "mp4" | "m4a" => "m4a",
                    "wav" => "wav",
                    _ => "webm",
                };
                let p = self
                    .media()?
                    .join(format!("voice-{}.{ext}", Uuid::new_v4()));
                std::fs::write(&p, data)?;
                Ok(json!({"path":p.to_string_lossy()}))
            }
            "mediaRead" => {
                use base64::Engine;
                let n = self.get(s(&m, "id"), false)?.ok_or("找不到录音")?;
                let p = self.checked_media(s(&n, "audio"))?;
                let mime = match p.extension().and_then(|x| x.to_str()).unwrap_or("") {
                    "m4a" | "mp4" => "audio/mp4",
                    "wav" => "audio/wav",
                    _ => "audio/webm",
                };
                Ok(
                    json!({"data":base64::engine::general_purpose::STANDARD.encode(std::fs::read(p)?),"mime":mime}),
                )
            }
            "mediaDiscard" => {
                let p = self.checked_media(s(&m, "path"))?;
                let count: i64 = self.db.query_row(
                    "SELECT count(*) FROM notes WHERE audio_path=?",
                    [p.to_string_lossy().as_ref()],
                    |r| r.get(0),
                )?;
                if count == 0 {
                    std::fs::remove_file(p)?;
                }
                Ok(json!(true))
            }
            _ => Err("不支持的操作".into()),
        }
    }
    pub fn checked_media(&self, path: &str) -> Result<PathBuf> {
        let original = Path::new(path);
        let p = original.canonicalize().or_else(|error| {
            // A recoverable recording draft can still contain its previous container path.
            let candidate = self
                .media()
                .ok()
                .and_then(|root| original.file_name().map(|name| root.join(name)));
            candidate.ok_or(error)?.canonicalize()
        })?;
        if !p.starts_with(self.media()?.canonicalize()?) || !p.is_file() {
            return Err("音频路径不属于此应用".into());
        }
        Ok(p)
    }
    pub fn put(&self, n: &Value) -> Result<()> {
        let tags = n["tags"].as_array().cloned().unwrap_or_default();
        let ai_tags = n["ai_tags"].as_array().cloned().unwrap_or_default();
        let index = spaced(&format!(
            "{} {} {} {} {}",
            s(n, "raw"),
            s(n, "transcript"),
            s(n, "summary"),
            json!(tags),
            json!(ai_tags)
        ));
        self.db.execute("INSERT INTO notes(id,created_at,updated_at,source,raw_text,search_uni,summary,tags,entities,audio_path,duration_ms,process_state,rev,deleted,transcript,ai_tags,attachment_id,ai_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,raw_text=excluded.raw_text,search_uni=excluded.search_uni,summary=excluded.summary,tags=excluded.tags,audio_path=excluded.audio_path,duration_ms=excluded.duration_ms,process_state=excluded.process_state,rev=excluded.rev,deleted=excluded.deleted,transcript=excluded.transcript,ai_tags=excluded.ai_tags,attachment_id=excluded.attachment_id,ai_status=excluded.ai_status",
   params![s(n,"id"),num(n,"created_at"),num(n,"updated_at"),s(n,"source"),s(n,"raw"),index,n["summary"].as_str(),json!(tags).to_string(),"{}",n["audio"].as_str(),(n["dur"].as_f64().unwrap_or(0.0)*1000.0) as i64,s(n,"state"),num(n,"rev"),n["deleted"].as_bool().unwrap_or(false),n["transcript"].as_str(),json!(ai_tags).to_string(),n["attachment_id"].as_str(),s(n,"ai_status")])?;
        Ok(())
    }
    pub fn search(&self, q: &str, source: &str) -> Result<Vec<Value>> {
        let terms: Vec<_> = q.split_whitespace().map(str::to_lowercase).collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        // Exact whole-term validation preserves Chinese phrase order. The local FTS index remains rebuildable.
        let mut predicates = Vec::new();
        let mut bindings = Vec::new();
        for term in &terms {
            let quote = |text: &str| format!("\"{}\"", text.replace('"', "\"\""));
            let mut candidates =
                "SELECT rowid FROM notes_fts_unigram WHERE notes_fts_unigram MATCH ?".to_string();
            bindings.push(quote(&spaced(term)));
            if term.chars().count() >= 3 {
                candidates.push_str(" UNION SELECT rowid FROM notes_fts_trigram WHERE notes_fts_trigram MATCH ? UNION SELECT rowid FROM notes_fts_ai WHERE notes_fts_ai MATCH ?");
                bindings.push(quote(term));
                bindings.push(quote(term));
            }
            predicates.push(format!("rowid IN ({candidates})"));
        }
        let mut stmt = self.db.prepare(&format!(
            "SELECT * FROM notes WHERE deleted=0 AND {} ORDER BY updated_at DESC,id DESC",
            predicates.join(" AND ")
        ))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(bindings), note)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .filter(|n| {
                (source.is_empty() || s(n, "source") == source)
                    && terms.iter().all(|t| {
                        [
                            s(n, "raw").to_string(),
                            s(n, "transcript").to_string(),
                            s(n, "summary").to_string(),
                        ]
                        .into_iter()
                        .chain(
                            n["tags"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                                .map(str::to_string),
                        )
                        .chain(
                            n["ai_tags"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                                .map(str::to_string),
                        )
                        .any(|f| f.to_lowercase().contains(t))
                    })
            })
            .take(200)
            .collect())
    }
    fn export(&self, m: &Value) -> Result<Value> {
        let rows = if s(m, "id").is_empty() {
            self.notes()?
        } else {
            vec![self.get(s(m, "id"), false)?.ok_or("记忆不存在")?]
        };
        let md = s(m, "format") == "md";
        let body = if md {
            rows.iter()
                .filter(|n| n["deleted"] != true)
                .map(|n| {
                    format!(
                        "## {} {}\n\n{}\n\n{}\n",
                        s(n, "day"),
                        s(n, "time"),
                        s(n, "raw"),
                        s(n, "transcript")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n---\n")
        } else {
            serde_json::to_string_pretty(&json!({"version":1,"notes":rows}))?
        };
        let path = self.media()?.join(format!(
            "只言-导出-{}.{}",
            now(),
            if md { "md" } else { "json" }
        ));
        std::fs::write(&path, body)?;
        Ok(json!({"path":path.to_string_lossy()}))
    }
}
fn note(r: &Row) -> rusqlite::Result<Value> {
    let get = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
    let i = |k: &str| r.get::<_, i64>(k).unwrap_or(0);
    let t = Local
        .timestamp_millis_opt(i("created_at"))
        .single()
        .unwrap_or_else(Local::now);
    Ok(
        json!({"id":get("id"),"created_at":i("created_at"),"updated_at":i("updated_at"),"day":t.format("%Y-%m-%d").to_string(),"time":t.format("%H:%M").to_string(),"source":get("source"),"raw":get("raw_text").unwrap_or_default(),"summary":get("summary"),"tags":parsed(get("tags").unwrap_or("[]".into())),"entities":{},"audio":get("audio_path"),"dur":i("duration_ms") as f64/1000.0,"state":get("process_state"),"rev":i("rev"),"deleted":i("deleted")!=0,"transcript":get("transcript"),"ai_tags":parsed(get("ai_tags").unwrap_or("[]".into())),"attachment_id":get("attachment_id"),"ai_status":get("ai_status").unwrap_or_default()}),
    )
}
pub fn spaced(text: &str) -> String {
    let mut out = String::new();
    let mut previous = false;
    for c in text.chars() {
        let u = c as u32;
        let cjk = matches!(u,0x4e00..=0x9fff|0x3400..=0x4dbf|0x3040..=0x30ff|0xac00..=0xd7af|0xf900..=0xfaff);
        if (cjk || previous) && !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
        out.push(c);
        previous = cjk;
    }
    out.trim().into()
}

/// Execute one JSON operation for the Swift bridge.
/// # Safety
/// Both arguments must point to live, NUL-terminated UTF-8 strings for this call.
/// The returned allocation must be released exactly once with `zy_core_free`.
#[no_mangle]
pub unsafe extern "C" fn zy_core_call(path: *const c_char, request: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<Value> {
        if path.is_null() || request.is_null() {
            return Err("请求为空".into());
        }
        let path = CStr::from_ptr(path).to_str()?;
        let m = serde_json::from_slice(CStr::from_ptr(request).to_bytes())?;
        Core::open(path)?.call(m)
    });
    let value = match result {
        Ok(Ok(v)) => json!({"ok":true,"data":v}),
        Ok(Err(e)) => json!({"ok":false,"error":e.to_string()}),
        Err(_) => json!({"ok":false,"error":"原生服务发生错误"}),
    };
    CString::new(value.to_string()).unwrap().into_raw()
}
/// Release a response allocated by `zy_core_call`.
/// # Safety
/// `ptr` must be null or an unreleased pointer returned by `zy_core_call`.
#[no_mangle]
pub unsafe extern "C" fn zy_core_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}
