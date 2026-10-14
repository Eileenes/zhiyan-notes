use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};
use zhiyan_core::Core;
const KEY: &str = "zy_test_access_0123456789abcdef0123456789abcdef";
struct Fixture {
    _dir: tempfile::TempDir,
    core: Core,
    client: Client,
    base: String,
    port: u16,
}
impl Fixture {
    fn new(write: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut core = Core::open(dir.path().join("notes.db")).unwrap();
        core.call(json!({"op":"save","id":"garden","text":"上海旅行，花园咖啡店","tags":["旅行"]}))
            .unwrap();
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        core.call(
            json!({"op":"gatewayStart","config":{"port":port,"allow_write":write},"key":KEY}),
        )
        .unwrap();
        Self {
            _dir: dir,
            core,
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
            base: format!("http://127.0.0.1:{port}"),
            port,
        }
    }
    fn rpc(&self, value: Value) -> reqwest::blocking::Response {
        self.client
            .post(format!("{}/mcp", self.base))
            .bearer_auth(KEY)
            .header("Accept", "application/json, text/event-stream")
            .json(&value)
            .send()
            .unwrap()
    }
    fn call(&self, name: &str, args: Value) -> Value {
        self.rpc(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":args}})).json().unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.core.call(json!({"op":"gatewayStop"})).unwrap();
    }
}
#[test]
fn mcp_lifecycle_auth_tools_and_read_only_boundary() {
    let f = Fixture::new(false);
    assert_eq!(
        f.client
            .get(format!("{}/v1/models", f.base))
            .send()
            .unwrap()
            .status(),
        401
    );
    for (header, value) in [
        ("Origin", "https://untrusted.example"),
        ("Host", "untrusted.example"),
    ] {
        assert_eq!(
            f.client
                .get(format!("{}/v1/models", f.base))
                .bearer_auth(KEY)
                .header(header, value)
                .send()
                .unwrap()
                .status(),
            403
        );
    }
    let init:Value=f.rpc(json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).json().unwrap();
    assert_eq!(init["result"]["protocolVersion"], "2025-11-25");
    assert!(init["result"]["capabilities"]["tools"].is_object());
    assert_eq!(
        f.rpc(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .status(),
        202
    );
    assert_eq!(
        f.client
            .get(format!("{}/mcp", f.base))
            .bearer_auth(KEY)
            .send()
            .unwrap()
            .status(),
        405
    );
    let list: Value = f
        .rpc(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}))
        .json()
        .unwrap();
    assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 2);
    let result = f.call("search_memories", json!({"query":"上海"}));
    assert_eq!(
        result["result"]["structuredContent"]["memories"][0]["id"],
        "garden"
    );
    let memory = f.call("get_memory", json!({"id":"garden"}));
    assert_eq!(
        memory["result"]["structuredContent"]["memory"]["text"],
        "上海旅行，花园咖啡店"
    );
    for field in ["audio", "audio_path", "key", "attachment_id", "search_uni"] {
        assert!(memory["result"]["structuredContent"]["memory"]
            .get(field)
            .is_none());
    }
    assert_eq!(
        f.call("create_memory", json!({"text":"not authorized"}))["error"]["code"],
        -32602
    );
    assert_eq!(
        f.call("search_memories", json!({"query":"上海","op":"delete"}))["result"]["isError"],
        true
    );
    assert_eq!(
        f.call("search_memories", json!({"query":"上海","limit":100}))["result"]["isError"],
        true
    );
    assert_eq!(f.core.stats().unwrap()["total"], 1);
}
#[test]
fn write_is_explicit_idempotent_and_flows_into_local_sync() {
    let mut f = Fixture::new(true);
    let id = uuid::Uuid::new_v4().to_string();
    let result = f.call(
        "create_memory",
        json!({"text":"MCP 种下一朵花","tags":["MCP"],"request_id":id}),
    );
    assert_eq!(result["result"]["structuredContent"]["created"], true);
    let note_id = result["result"]["structuredContent"]["memory"]["id"]
        .as_str()
        .unwrap();
    assert_eq!(
        f.core.get(note_id, false).unwrap().unwrap()["raw"],
        "MCP 种下一朵花"
    );
    assert!(f.core.sync_status().unwrap()["pending"].as_i64().unwrap() >= 2);
    let duplicate = f.call(
        "create_memory",
        json!({"text":"MCP 种下一朵花","tags":["MCP"],"request_id":id}),
    );
    assert_eq!(duplicate["result"]["structuredContent"]["created"], false);
    assert_eq!(f.core.stats().unwrap()["total"], 2);
    assert_eq!(
        f.call("create_memory", json!({"text":"different","request_id":id}))["result"]["isError"],
        true
    );
    assert_eq!(
        f.call("create_memory", json!({"text":"test","id":"garden"}))["result"]["isError"],
        true
    );
    assert_eq!(f.rpc(json!({"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_memory","arguments":{"text":"silent mutation"}}})).status(),400);
    f.core.call(json!({"op":"delete","id":note_id})).unwrap();
    assert_eq!(
        f.call("get_memory", json!({"id":note_id}))["result"]["isError"],
        true
    );
    assert_eq!(
        f.call(
            "create_memory",
            json!({"text":"MCP 种下一朵花","tags":["MCP"],"request_id":id})
        )["result"]["isError"],
        true
    );
}
#[test]
fn openai_retrieval_json_sse_and_unsupported_requests() {
    let f = Fixture::new(false);
    let models: Value = f
        .client
        .get(format!("{}/v1/models", f.base))
        .bearer_auth(KEY)
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(models["data"][0]["id"], "zhiyan-memory-search");
    assert_eq!(models["data"].as_array().unwrap().len(), 1);
    let mut payload =
        json!({"model":"zhiyan-memory-search","messages":[{"role":"user","content":"上海"}]});
    let request = |p: &Value| {
        f.client
            .post(format!("{}/v1/chat/completions", f.base))
            .bearer_auth(KEY)
            .json(p)
            .send()
            .unwrap()
    };
    let data: Value = request(&payload).json().unwrap();
    assert_eq!(data["object"], "chat.completion");
    let content: Value =
        serde_json::from_str(data["choices"][0]["message"]["content"].as_str().unwrap()).unwrap();
    assert_eq!(content["memories"][0]["id"], "garden");
    payload["stream"] = json!(true);
    let response = request(&payload);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    let text = response.text().unwrap();
    assert!(text.ends_with("data: [DONE]\n\n"));
    let chunks: Vec<Value> = text
        .split("\n\n")
        .filter_map(|l| l.strip_prefix("data: "))
        .filter(|l| *l != "[DONE]")
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0]["choices"][0]["delta"]["role"], "assistant");
    assert_eq!(chunks[2]["choices"][0]["finish_reason"], "stop");
    payload["model"] = json!("zhiyan-memory");
    assert_eq!(request(&payload).status(), 503);
    payload["model"] = json!("does-not-exist");
    assert_eq!(request(&payload).status(), 404);
    payload["model"] = json!("zhiyan-memory-search");
    payload["tools"] = json!([]);
    assert_eq!(request(&payload).status(), 400);
    payload.as_object_mut().unwrap().remove("tools");
    payload["messages"][0]["content"] = json!([{"type":"image_url"}]);
    assert_eq!(request(&payload).status(), 400);
}
#[test]
fn rotation_stop_restart_limits_and_protocol_errors() {
    let mut f = Fixture::new(false);
    assert!(f
        .core
        .call(json!({"op":"gatewayStart","config":{"port":f.port},"key":KEY}))
        .is_err());
    assert_eq!(
        f.rpc(json!([])).json::<Value>().unwrap()["error"]["code"],
        -32600
    );
    assert_eq!(
        f.client
            .post(format!("{}/mcp", f.base))
            .bearer_auth(KEY)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", "2099-01-01")
            .json(&json!({}))
            .send()
            .unwrap()
            .status(),
        400
    );
    let big = format!("{{\"body\":\"{}\"}}", "a".repeat(129 * 1024));
    assert_eq!(
        f.client
            .post(format!("{}/mcp", f.base))
            .bearer_auth(KEY)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .body(big)
            .send()
            .unwrap()
            .status(),
        413
    );
    let replacement = "zy_replacement_0123456789abcdef0123456789abcdef";
    f.core
        .call(json!({"op":"gatewayRotate","key":replacement}))
        .unwrap();
    assert_eq!(
        f.client
            .get(format!("{}/v1/models", f.base))
            .bearer_auth(KEY)
            .send()
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        f.client
            .get(format!("{}/v1/models", f.base))
            .bearer_auth(replacement)
            .send()
            .unwrap()
            .status(),
        200
    );
    assert!(!f
        .core
        .meta("gateway_config")
        .unwrap()
        .to_string()
        .contains("replacement"));
    f.core.call(json!({"op":"gatewayStop"})).unwrap();
    assert!(f
        .client
        .get(format!("{}/v1/models", f.base))
        .bearer_auth(replacement)
        .send()
        .is_err());
    assert_eq!(
        f.core.call(json!({"op":"gatewayStatus"})).unwrap()["running"],
        false
    );
    f.core
        .call(json!({"op":"gatewayStart","config":{"port":f.port,"mcp":false},"key":KEY}))
        .unwrap();
    assert_eq!(f.rpc(json!({})).status(), 404);
    for _ in 0..119 {
        assert_eq!(
            f.client
                .get(format!("{}/v1/models", f.base))
                .bearer_auth(KEY)
                .send()
                .unwrap()
                .status(),
            200
        );
    }
    assert_eq!(
        f.client
            .get(format!("{}/v1/models", f.base))
            .bearer_auth(KEY)
            .send()
            .unwrap()
            .status(),
        429
    );
}
#[test]
fn memory_qa_uses_configured_provider_and_cites_real_context() {
    let mut f = Fixture::new(false);
    f.core.call(json!({"op":"gatewayStop"})).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let thread = std::thread::spawn(move || {
        for i in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut byte = [0];
            while !bytes.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                bytes.push(byte[0]);
            }
            let headers = String::from_utf8(bytes).unwrap();
            assert!(headers
                .to_lowercase()
                .contains("authorization: bearer upstream-test-key"));
            let length = headers
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length: ")
                        .map(|v| v.parse::<usize>().unwrap())
                })
                .unwrap();
            let mut bytes = vec![0; length];
            socket.read_exact(&mut bytes).unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            let prompt = body["messages"][0]["content"].as_str().unwrap();
            if i == 1 {
                assert!(prompt.contains("上海旅行，花园咖啡店"));
                assert!(prompt.contains("garden"));
            }
            let text = if i == 0 {
                "[\"上海\",\"咖啡\"]"
            } else {
                "你记录了上海的花园咖啡店。[garden]"
            };
            let body = json!({"choices":[{"message":{"content":text}}]}).to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    let provider = json!({"id":"mock","name":"Mock provider","protocol":"openai","model":"fixture","baseUrl":format!("http://127.0.0.1:{port}/v1")});
    f.core.call(json!({"op":"providersSave","providers":[provider.clone()]})).unwrap();
    let consent = json!({ format!("mock|http://127.0.0.1:{port}"): 1 }).to_string();
    f.core.call(json!({"op":"prefsSet","key":"aiConsent","value":consent})).unwrap();
    f.core.call(json!({"op":"gatewayStart","config":{"port":f.port},"key":KEY,"provider":provider,"provider_key":"upstream-test-key"})).unwrap();
    let r:Value=f.client.post(format!("{}/v1/chat/completions",f.base)).bearer_auth(KEY).json(&json!({"model":"zhiyan-memory","messages":[{"role":"user","content":"我在上海记过什么咖啡店？"}]})).send().unwrap().json().unwrap();
    assert_eq!(
        r["choices"][0]["message"]["content"],
        "你记录了上海的花园咖啡店。[garden]"
    );
    assert!(!f
        .core
        .call(json!({"op":"gatewayStatus"}))
        .unwrap()
        .to_string()
        .contains("upstream-test-key"));
    thread.join().unwrap();
    // Per-request checks: no restart needed for these to take effect, and
    // the mock (which only accepts two connections) is never contacted again.
    let ask = |f: &Fixture| {
        f.client.post(format!("{}/v1/chat/completions",f.base)).bearer_auth(KEY)
            .json(&json!({"model":"zhiyan-memory","messages":[{"role":"user","content":"咖啡店？"}]}))
            .send().unwrap().status().as_u16()
    };
    f.core.call(json!({"op":"prefsSet","key":"aiConsent","value":"{}"})).unwrap();
    assert_eq!(ask(&f), 403, "revoked consent blocks the running gateway");
    f.core.call(json!({"op":"prefsSet","key":"aiConsent","value":consent})).unwrap();
    let mut moved = provider.clone();
    moved["baseUrl"] = json!("https://elsewhere.example/v1");
    f.core.call(json!({"op":"providersSave","providers":[moved]})).unwrap();
    assert_eq!(ask(&f), 409, "provider address change blocks the running gateway");
    let mut off = provider.clone();
    off["enabled"] = json!(false);
    f.core.call(json!({"op":"providersSave","providers":[off]})).unwrap();
    assert_eq!(ask(&f), 409, "disabled provider blocks the running gateway");
    // Search-only model never sends anything upstream and stays available.
    let r = f.client.post(format!("{}/v1/chat/completions",f.base)).bearer_auth(KEY)
        .json(&json!({"model":"zhiyan-memory-search","messages":[{"role":"user","content":"咖啡"}]}))
        .send().unwrap();
    assert_eq!(r.status().as_u16(), 200);
}

#[test]
fn revoking_a_key_also_blocks_a_write_waiting_for_the_database() {
    let f = Fixture::new(true);
    let blocker = Core::open(&f.core.path).unwrap();
    blocker.db.execute_batch("BEGIN IMMEDIATE").unwrap();
    let client = f.client.clone();
    let url = format!("{}/mcp", f.base);
    let request = std::thread::spawn(move || {
        client.post(url).bearer_auth(KEY).header("Accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_memory","arguments":{"text":"must not commit after key rotation"}}})).send().unwrap().status()
    });
    for _ in 0..100 {
        if zhiyan_core::gateway::status(&f.core).unwrap()["requests"]
            .as_u64()
            .unwrap()
            > 0
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    zhiyan_core::gateway::rotate(
        &f.core,
        "zy_revoked_fixture_0123456789abcdef0123456789abcdef",
    )
    .unwrap();
    blocker.db.execute_batch("ROLLBACK").unwrap();
    assert_eq!(request.join().unwrap(), 401);
    assert_eq!(f.core.stats().unwrap()["total"], 1);
}
