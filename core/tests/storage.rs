use serde_json::json;
use zhiyan_core::Core;
#[test]
fn migration_search_paging_outbox_and_export() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("notes.db");
    let mut c = Core::open(&path).unwrap();
    for i in 0..65 {
        c.call(json!({"op":"save","id":format!("n{i:03}"),"text":format!("上海花园 {i}"),"tags":["旅行"]})).unwrap();
    }
    let first = c.call(json!({"op":"page"})).unwrap();
    assert_eq!(first["notes"].as_array().unwrap().len(), 50);
    let last = first["notes"].as_array().unwrap().last().unwrap();
    let next = c
        .call(json!({"op":"page","before":last["created_at"],"beforeID":last["id"]}))
        .unwrap();
    assert_eq!(next["notes"].as_array().unwrap().len(), 15);
    assert_eq!(c.search("上海 花园", "").unwrap().len(), 65);
    assert!(c.search("海上", "").unwrap().is_empty());
    c.call(json!({"op":"delete","id":"n000"})).unwrap();
    assert_eq!(c.search("上海", "").unwrap().len(), 64);
    c.call(json!({"op":"restore","id":"n000"})).unwrap();
    assert_eq!(c.sync_status().unwrap()["pending"], 65);
    drop(c);
    let mut reopened = Core::open(path).unwrap();
    assert_eq!(reopened.stats().unwrap()["total"], 65);
    let exported = reopened
        .call(json!({"op":"export","format":"json"}))
        .unwrap();
    assert!(std::path::Path::new(exported["path"].as_str().unwrap()).exists());
}
#[test]
fn providers_strip_secrets_and_reject_insecure_urls() {
    let t = tempfile::tempdir().unwrap();
    let mut c = Core::open(t.path().join("notes.db")).unwrap();
    let mut p = json!({"id":"mine","name":"自定义","protocol":"anthropic","model":"custom-model","baseUrl":"https://example.com/v1","key":"must-not-store"});
    let result = c
        .call(json!({"op":"providersSave","providers":[p]}))
        .unwrap();
    assert!(result[0].get("key").is_none());
    p["baseUrl"] = json!("http://example.com");
    assert!(c
        .call(json!({"op":"providersSave","providers":[p]}))
        .is_err());
    assert!(!c
        .meta("providers")
        .unwrap()
        .to_string()
        .contains("must-not-store"));
}
#[test]
fn bound_library_cannot_leak_to_another_account() {
    let t = tempfile::tempdir().unwrap();
    let mut c = Core::open(t.path().join("notes.db")).unwrap();
    c.call(json!({"op":"syncBind","url":"https://example.com","user":{"id":"alice","username":"alice"},"device_id":"phone"})).unwrap();
    assert!(c.call(json!({"op":"syncBind","url":"https://example.com","user":{"id":"bob","username":"bob"},"device_id":"phone"})).is_err());
    assert_eq!(c.sync_status().unwrap()["account"]["user_id"], "alice");
}

#[test]
fn western_substrings_and_ai_text_use_trigram() {
    let t = tempfile::tempdir().unwrap();
    let mut c = Core::open(t.path().join("notes.db")).unwrap();
    c.call(json!({"op":"save","id":"en","text":"MyOpenSourceGarden"}))
        .unwrap();
    let mut note = c.get("en", false).unwrap().unwrap();
    note["transcript"] = json!("CustomTranscriptionTest");
    c.put(&note).unwrap();
    assert_eq!(c.search("Source", "").unwrap().len(), 1);
    assert_eq!(c.search("scription", "").unwrap().len(), 1);
}

#[test]
fn moving_database_repairs_local_audio_without_queueing_an_edit() {
    let root = tempfile::tempdir().unwrap();
    let old = root.path().join("old");
    let new = root.path().join("new");
    let mut c = Core::open(old.join("notes.db")).unwrap();
    let file = c.media().unwrap().join("voice.wav");
    std::fs::write(&file, b"RIFF fixture").unwrap();
    c.call(json!({"op":"save","id":"voice","text":"","audio":file.to_string_lossy()}))
        .unwrap();
    drop(c);
    std::fs::rename(&old, &new).unwrap();
    let c = Core::open(new.join("notes.db")).unwrap();
    let note = c.get("voice", false).unwrap().unwrap();
    assert_eq!(
        note["audio"].as_str().unwrap(),
        new.join("media/voice.wav").to_str().unwrap()
    );
    assert_eq!(note["rev"], 1);
    assert_eq!(
        c.checked_media(file.to_str().unwrap()).unwrap(),
        new.join("media/voice.wav").canonicalize().unwrap()
    );
}
