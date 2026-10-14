//! The Apple shells talk to the core only through the C ABI (`zy_core_call`,
//! see build/Services.swift CoreServices.call). This drives an AI task the way
//! NativeBridge.swift does: prefsSet(aiConsent) is mirrored into the core
//! (NativeBridge.syncConsent) and then aiEnqueue/aiRun go through the ABI.
use serde_json::{json, Value};
use std::{
    ffi::{CStr, CString},
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};
use zhiyan_core::{zy_core_call, zy_core_free};

fn call(db: &str, req: Value) -> Value {
    let p = CString::new(db).unwrap();
    let q = CString::new(req.to_string()).unwrap();
    unsafe {
        let out = zy_core_call(p.as_ptr(), q.as_ptr());
        assert!(!out.is_null());
        let v: Value = serde_json::from_str(CStr::from_ptr(out).to_str().unwrap()).unwrap();
        zy_core_free(out);
        v
    }
}
fn ok(db: &str, req: Value) -> Value {
    let r = call(db, req);
    assert_eq!(r["ok"], true, "{r}");
    r["data"].clone()
}

/// One-shot OpenAI-compatible upstream returning a summary.
fn upstream() -> (u16, std::thread::JoinHandle<String>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let t = std::thread::spawn(move || {
        let (mut s, _) = l.accept().unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let (mut head, mut b) = (Vec::new(), [0u8]);
        while !head.ends_with(b"\r\n\r\n") {
            s.read_exact(&mut b).unwrap();
            head.push(b[0]);
        }
        let head = String::from_utf8(head).unwrap();
        let len: usize = head
            .lines()
            .find_map(|l| l.to_lowercase().strip_prefix("content-length: ").map(|v| v.trim().parse().unwrap()))
            .unwrap();
        let mut body = vec![0; len];
        s.read_exact(&mut body).unwrap();
        let text = json!({"summary":"花园咖啡店","tags":["咖啡"]}).to_string();
        let resp = json!({"choices":[{"message":{"content":text}}]}).to_string();
        write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", resp.len(), resp).unwrap();
        String::from_utf8(body).unwrap()
    });
    (port, t)
}

fn setup(port: u16) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("notes.db").to_str().unwrap().to_string();
    ok(&db, json!({"op":"save","id":"n1","text":"上海的花园咖啡店","tags":[]}));
    ok(&db, json!({"op":"providersSave","providers":[{"id":"p1","name":"P","protocol":"openai","model":"m","baseUrl":format!("http://127.0.0.1:{port}/v1"),"enabled":true}]}));
    (dir, db)
}

#[test]
fn apple_bridge_consent_sync_lets_ai_task_run() {
    let (port, server) = upstream();
    let (_dir, db) = setup(port);
    // What the UI stores (privacy.js Consent.grant) and NativeBridge mirrors.
    let consent = json!({ format!("p1|http://127.0.0.1:{port}"): 1 }).to_string();
    ok(&db, json!({"op":"prefsSet","key":"aiConsent","value":consent}));
    let jobs = ok(&db, json!({"op":"aiEnqueue","id":"n1","kind":"summary","provider_id":"p1"}));
    let id = jobs[0]["id"].as_str().unwrap().to_string();
    ok(&db, json!({"op":"aiRun","id":id,"key":"k"}));
    assert!(server.join().unwrap().contains("上海的花园咖啡店"));
    let note = ok(&db, json!({"op":"get","id":"n1"}));
    assert_eq!(note["summary"], "花园咖啡店", "{note}");
}

#[test]
fn apple_bridge_without_consent_sync_is_refused() {
    // Regression for round 3: consent only in preferences.json (not mirrored)
    // must not be silently ignored either way: the core refuses, nothing sent.
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    l.set_nonblocking(true).unwrap();
    let port = l.local_addr().unwrap().port();
    let (_dir, db) = setup(port);
    let jobs = ok(&db, json!({"op":"aiEnqueue","id":"n1","kind":"summary","provider_id":"p1"}));
    let r = call(&db, json!({"op":"aiRun","id":jobs[0]["id"],"key":"k"}));
    assert_eq!(r["ok"], false);
    assert!(r["error"].as_str().unwrap().contains("尚未同意"));
    assert!(l.accept().is_err());
}

#[test]
fn native_bridge_mirrors_ai_consent_into_core() {
    // Static guard (Swift is not compiled on Linux CI): prefsSet(aiConsent)
    // and launch must both forward consent to the core via the C ABI.
    let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../build/NativeBridge.swift")).unwrap()
        // Windows checkouts may use CRLF.
        .replace("\r\n", "\n");
    let prefs = &src[src.find("case \"prefsSet\":").unwrap()..];
    let prefs = &prefs[..prefs.find("reply(seq, true, \"ok\")").unwrap()];
    let sync = prefs.find("syncConsent").expect("prefsSet must call syncConsent");
    assert!(sync < prefs.find("write(to: preferencesURL").unwrap(), "core before preferences.json");
    assert!(src.contains("\"op\": \"prefsSet\", \"key\": \"aiConsent\""));
    let init = &src[src.find("init(store: DataStore").unwrap()..];
    assert!(init[..init.find("\n  }\n").unwrap()].contains("syncConsent"), "launch re-sync");
}
