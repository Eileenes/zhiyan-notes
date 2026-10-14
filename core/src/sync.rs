use crate::{json, model, now, num, s, Core, Result, Value};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::io::Read;

fn base(account: &Value) -> Result<String> {
    Ok(model::validate_url(s(account, "url"))?
        .as_str()
        .trim_end_matches('/')
        .to_string())
}
pub fn auth(m: &Value) -> Result<Value> {
    let url = base(m)?;
    let action = if m["register"].as_bool().unwrap_or(false) {
        "register"
    } else {
        "login"
    };
    model::response(model::client(30)?.post(format!("{url}/v1/auth/{action}")).json(&json!({"username":m["username"],"password":m["password"],"device_id":m["device_id"],"device_name":m["device_name"],"invite_code":m["invite_code"].as_str().unwrap_or("")})).send()?,s(m,"password"))
}
pub fn logout(account: &Value, token: &str) -> Result<Value> {
    model::response(
        model::client(20)?
            .post(format!("{}/v1/auth/logout", base(account)?))
            .bearer_auth(token)
            .send()?,
        token,
    )
}
pub fn delete_account(account: &Value, token: &str, password: &str, confirm: &str) -> Result<Value> {
    let r = model::response(
        model::client(30)?
            .delete(format!("{}/v1/account", base(account)?))
            .bearer_auth(token)
            .json(&json!({"password":password,"confirm":confirm}))
            .send()?,
        token,
    );
    r.map_err(|e| e.to_string().replace(password, "[已隐藏]").into())
}
fn wire(n: &Value) -> Value {
    let mut v = json!({});
    for key in [
        "id",
        "created_at",
        "updated_at",
        "source",
        "raw",
        "transcript",
        "summary",
        "tags",
        "ai_tags",
        "attachment_id",
        "dur",
        "state",
        "deleted",
    ] {
        v[key] = n[key].clone();
    }
    v
}

impl Core {
    pub fn sync_status(&self) -> Result<Value> {
        Ok(
            json!({"account":self.meta("sync_account")?,"enabled":self.meta("sync_enabled")?==true,"pending":self.db.query_row("SELECT count(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0))?,"conflicts":self.db.query_row("SELECT count(*) FROM sync_conflicts",[],|r|r.get::<_,i64>(0))?,"last_synced":self.meta("last_synced")?,"error":self.meta("sync_error")?,"more":self.meta("sync_more")?==true}),
        )
    }
    pub fn bind(&mut self, m: &Value) -> Result<Value> {
        let url = base(m)?;
        let account = json!({"url":url,"user_id":m["user"]["id"],"username":m["user"]["username"],"device_id":m["device_id"]});
        if s(&account, "user_id").is_empty() {
            return Err("账号信息不完整".into());
        }
        let previous = self.meta("sync_account")?;
        if !previous.is_null()
            && (previous["user_id"] != account["user_id"] || previous["url"] != account["url"])
        {
            return Err("这个资料库已绑定另一账号，请切换到该账号的独立资料库".into());
        }
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<()> {
            if previous.is_null() {
                self.db.execute("INSERT OR IGNORE INTO sync_outbox SELECT id,lower(hex(randomblob(16))),rev FROM notes",[])?;
            }
            self.set_meta("sync_account", &account)?;
            self.set_meta("sync_enabled", &json!(true))?;
            self.set_meta("sync_error", &Value::Null)?;
            Ok(())
        })();
        match result {
            Ok(()) => self.db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        self.sync_status()
    }
    /// Forget the sync account on this device. Local notes stay; every
    /// sync-only table and cursor is reset so a later bind starts from scratch.
    pub fn unbind(&mut self) -> Result<Value> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<()> {
            self.db.execute_batch(
                "DELETE FROM sync_outbox; DELETE FROM sync_versions; DELETE FROM sync_conflicts;",
            )?;
            self.db.execute(
                "DELETE FROM app_meta WHERE key IN ('sync_account','sync_enabled','sync_cursor','sync_error','sync_more','sync_inflight','sync_lease','last_synced')",
                [],
            )?;
            // Server copies are gone: local recordings must be re-uploaded if bound again.
            self.db.execute("UPDATE notes SET attachment_id=NULL WHERE audio_path IS NOT NULL", [])?;
            Ok(())
        })();
        match result {
            Ok(()) => self.db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        self.sync_status()
    }
    fn server_rev(&self, id: &str) -> Result<i64> {
        Ok(self
            .db
            .query_row(
                "SELECT server_rev FROM sync_versions WHERE note_id=?",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }
    fn set_rev(&self, id: &str, rev: i64) -> Result<()> {
        self.db.execute("INSERT INTO sync_versions VALUES(?,?) ON CONFLICT(note_id) DO UPDATE SET server_rev=excluded.server_rev",params![id,rev])?;
        Ok(())
    }
    fn keep_conflict(&self, record: &Value) -> Result<()> {
        self.db.execute("INSERT INTO sync_conflicts VALUES(?,?) ON CONFLICT(note_id) DO UPDATE SET remote_json=excluded.remote_json",params![s(record,"id"),record.to_string()])?;
        Ok(())
    }
    fn apply_remote(&self, record: &Value) -> Result<()> {
        let id = s(record, "id");
        let old = self.get(id, true)?;
        let mut n = record["note"].clone();
        n["audio"] = if old
            .as_ref()
            .map(|old| old["attachment_id"] == n["attachment_id"])
            .unwrap_or(false)
        {
            old.as_ref().unwrap()["audio"].clone()
        } else {
            Value::Null
        };
        n["rev"] = json!(old.as_ref().map(|o| num(o, "rev") + 1).unwrap_or(1));
        self.db
            .execute("UPDATE app_meta SET value='1' WHERE key='remote_apply'", [])?;
        let r = self.put(&n);
        self.db
            .execute("UPDATE app_meta SET value='0' WHERE key='remote_apply'", [])?;
        r?;
        self.set_rev(id, num(record, "server_rev"))?;
        Ok(())
    }
    fn upload_audio(&self, n: &mut Value, url: &str, token: &str) -> Result<()> {
        if n["deleted"] == true || !n["attachment_id"].is_null() || s(n, "audio").is_empty() {
            return Ok(());
        }
        let path = self.checked_media(s(n, "audio"))?;
        let bytes = std::fs::read(path)?;
        if bytes.len() > 100 * 1024 * 1024 {
            return Err("录音超过 100 MB 同步限制".into());
        }
        let id = format!("{:x}", Sha256::digest(&bytes));
        model::response(
            model::client(110)?
                .put(format!("{url}/v1/attachments/{id}"))
                .bearer_auth(token)
                .header("content-type", "application/octet-stream")
                .body(bytes)
                .send()?,
            token,
        )?;
        self.db.execute(
            "UPDATE notes SET attachment_id=? WHERE id=? AND audio_path=?",
            params![id, s(n, "id"), s(n, "audio")],
        )?;
        n["attachment_id"] = json!(id);
        Ok(())
    }
    pub fn sync_run(&mut self, token: &str) -> Result<Value> {
        if self.meta("sync_enabled")? != true {
            return Err("同步尚未开启".into());
        }
        if token.is_empty() {
            return Err("请重新登录同步账号".into());
        }
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        if self.meta("sync_lease")?.as_i64().unwrap_or(0) > now() {
            self.db.execute_batch("ROLLBACK")?;
            return Err("同步正在进行".into());
        }
        self.set_meta("sync_lease", &json!(now() + 300_000))?;
        self.db.execute_batch("COMMIT")?;
        let result = self.sync_inner(token);
        self.set_meta("sync_lease", &json!(0))?;
        match &result {
            Ok(_) => {
                self.set_meta("sync_error", &Value::Null)?;
                self.set_meta("last_synced", &json!(now()))?;
            }
            Err(e) => self.set_meta(
                "sync_error",
                &json!(e.to_string().replace(token, "[已隐藏]")),
            )?,
        }
        result?;
        self.sync_status()
    }
    fn sync_inner(&mut self, token: &str) -> Result<()> {
        let started = std::time::Instant::now();
        let account = self.meta("sync_account")?;
        let url = base(&account)?;
        // Freeze the exact payload before sending. A response lost during a later local edit is safely retryable.
        let mut batch = self.meta("sync_inflight")?;
        if batch.is_null() {
            let queued=self.db.prepare("SELECT note_id,op_id,local_rev FROM sync_outbox WHERE note_id NOT IN (SELECT note_id FROM sync_conflicts) ORDER BY rowid LIMIT 50")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
            let mut ops = vec![];
            let mut payload_bytes = 0;
            for (id, op_id, rev) in queued {
                if started.elapsed().as_secs() > 120 {
                    break;
                }
                self.set_meta("sync_lease", &json!(now() + 300_000))?;
                if let Some(mut n) = self.get(&id, true)? {
                    if num(&n, "rev") != rev {
                        continue;
                    }
                    self.upload_audio(&mut n, &url, token)?;
                    let operation =
                        json!({"op_id":op_id,"base_rev":self.server_rev(&id)?,"note":wire(&n)});
                    let size = operation.to_string().len();
                    if size > 1_900_000 {
                        return Err(format!("记忆 {id} 内容过大，请拆分后同步").into());
                    }
                    if !ops.is_empty() && payload_bytes + size > 1_500_000 {
                        break;
                    }
                    payload_bytes += size;
                    ops.push(operation);
                }
            }
            batch = json!({"device_id":account["device_id"],"operations":ops});
            self.set_meta("sync_inflight", &batch)?;
        }
        if batch["operations"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
        {
            self.set_meta("sync_lease", &json!(now() + 300_000))?;
            let result = model::response(
                model::client(40)?
                    .post(format!("{url}/v1/sync/push"))
                    .bearer_auth(token)
                    .json(&batch)
                    .send()?,
                token,
            )?;
            let results = result["results"]
                .as_array()
                .ok_or("同步服务返回格式不正确")?;
            if results.len() != batch["operations"].as_array().unwrap().len() {
                return Err("同步确认条数不匹配".into());
            }
            self.db.execute_batch("BEGIN IMMEDIATE")?;
            let applied = (|| -> Result<()> {
                for (ack, op) in results.iter().zip(batch["operations"].as_array().unwrap()) {
                    let id = s(&op["note"], "id");
                    if s(ack, "id") != id {
                        return Err("同步确认标识不匹配".into());
                    }
                    if s(ack, "status") == "accepted" {
                        self.set_rev(id, num(&ack["record"], "server_rev"))?;
                        self.db.execute(
                            "DELETE FROM sync_outbox WHERE note_id=? AND op_id=?",
                            params![id, s(op, "op_id")],
                        )?;
                    } else if s(ack, "status") == "conflict" && !ack["record"].is_null() {
                        self.keep_conflict(&ack["record"])?;
                    } else {
                        return Err("同步服务返回未知状态".into());
                    }
                }
                self.set_meta("sync_inflight", &Value::Null)?;
                Ok(())
            })();
            match applied {
                Ok(()) => self.db.execute_batch("COMMIT")?,
                Err(e) => {
                    let _ = self.db.execute_batch("ROLLBACK");
                    return Err(e);
                }
            }
        } else {
            self.set_meta("sync_inflight", &Value::Null)?;
        }
        for _ in 0..25 {
            self.set_meta("sync_lease", &json!(now() + 300_000))?;
            let cursor = self.meta("sync_cursor")?.as_i64().unwrap_or(0);
            let result = model::response(
                model::client(30)?
                    .get(format!("{url}/v1/sync/pull?cursor={cursor}"))
                    .bearer_auth(token)
                    .send()?,
                token,
            )?;
            let records = result["records"]
                .as_array()
                .ok_or("同步服务未返回记录列表")?;
            self.db.execute_batch("BEGIN IMMEDIATE")?;
            let applied = (|| -> Result<()> {
                for record in records {
                    let id = s(record, "id");
                    if num(record, "server_rev") <= self.server_rev(id)? {
                        continue;
                    }
                    let pending: bool = self.db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE note_id=?)",
                        [id],
                        |r| r.get(0),
                    )?;
                    if pending {
                        self.keep_conflict(record)?;
                    } else {
                        self.apply_remote(record)?;
                    }
                }
                self.set_meta("sync_cursor", &result["cursor"])?;
                Ok(())
            })();
            match applied {
                Ok(()) => self.db.execute_batch("COMMIT")?,
                Err(e) => {
                    let _ = self.db.execute_batch("ROLLBACK");
                    return Err(e);
                }
            }
            self.set_meta("sync_more", &result["has_more"])?;
            if result["has_more"] != true || started.elapsed().as_secs() > 180 {
                break;
            }
        }
        Ok(())
    }
    pub fn conflicts(&self) -> Result<Vec<Value>> {
        let rows = self
            .db
            .prepare("SELECT remote_json FROM sync_conflicts")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter().map(|row|->Result<Value>{let remote:Value=serde_json::from_str(&row)?;Ok(json!({"id":remote["id"],"local":self.get(s(&remote,"id"),true)?,"remote":remote}))}).collect()
    }
    pub fn resolve(&mut self, m: &Value) -> Result<Value> {
        let raw: String = self.db.query_row(
            "SELECT remote_json FROM sync_conflicts WHERE note_id=?",
            [s(m, "id")],
            |r| r.get(0),
        )?;
        let remote: Value = serde_json::from_str(&raw)?;
        let choice = s(m, "choice");
        if !["local", "remote", "both"].contains(&choice) {
            return Err("请选择冲突处理方式".into());
        }
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<()> {
            if choice == "local" {
                self.set_rev(s(m, "id"), num(&remote, "server_rev"))?;
                self.db.execute(
                    "UPDATE sync_outbox SET op_id=lower(hex(randomblob(16))) WHERE note_id=?",
                    [s(m, "id")],
                )?;
            } else {
                if choice == "both" {
                    let mut local = self.get(s(m, "id"), true)?.ok_or("本机记忆不存在")?;
                    local["id"] = json!(uuid::Uuid::new_v4().to_string());
                    local["rev"] = json!(1);
                    local["deleted"] = json!(false);
                    local["created_at"] = json!(now());
                    let mut tags = local["tags"].as_array().cloned().unwrap_or_default();
                    tags.push(json!("冲突副本"));
                    local["tags"] = json!(tags);
                    self.put(&local)?;
                }
                self.apply_remote(&remote)?;
                self.db
                    .execute("DELETE FROM sync_outbox WHERE note_id=?", [s(m, "id")])?;
            }
            self.db
                .execute("DELETE FROM sync_conflicts WHERE note_id=?", [s(m, "id")])?;
            Ok(())
        })();
        match result {
            Ok(()) => self.db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        self.sync_status()
    }
    pub fn download_audio(&self, id: &str, token: &str) -> Result<Value> {
        let n = self.get(id, false)?.ok_or("记忆不存在")?;
        if !s(&n, "audio").is_empty() && self.checked_media(s(&n, "audio")).is_ok() {
            return Ok(n);
        }
        let aid = s(&n, "attachment_id");
        if aid.len() != 64 || !aid.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("录音尚未上传，请在原设备同步".into());
        }
        let account = self.meta("sync_account")?;
        let mut r = model::client(110)?
            .get(format!("{}/v1/attachments/{aid}", base(&account)?))
            .bearer_auth(token)
            .send()?;
        if !r.status().is_success() {
            return Err(format!("录音下载失败：{}", r.status().as_u16()).into());
        }
        let mut data = vec![];
        r.by_ref()
            .take(100 * 1024 * 1024 + 1)
            .read_to_end(&mut data)?;
        if data.len() > 100 * 1024 * 1024 || format!("{:x}", Sha256::digest(&data)) != aid {
            return Err("录音下载校验失败，请重试".into());
        }
        let ext = if data.starts_with(b"RIFF") {
            "wav"
        } else if data.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
            "webm"
        } else {
            "m4a"
        };
        let path = self.media()?.join(format!("synced-{aid}.{ext}"));
        let tmp = path.with_extension("part");
        std::fs::write(&tmp, data)?;
        std::fs::rename(tmp, &path)?;
        self.db.execute(
            "UPDATE notes SET audio_path=? WHERE id=? AND attachment_id=?",
            params![path.to_string_lossy().as_ref(), id, aid],
        )?;
        self.get(id, false)?.ok_or("记忆已删除".into())
    }
}
