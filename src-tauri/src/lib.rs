use serde_json::Value;
use std::path::PathBuf;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;
struct AppData(PathBuf);

#[tauri::command]
async fn native_call(
    app: tauri::AppHandle,
    state: State<'_, AppData>,
    message: Value,
) -> Result<Value, String> {
    let path = state.0.clone();
    if zhiyan_core::s(&message, "op").starts_with("gateway") {
        return tauri::async_runtime::spawn_blocking(move || gateway_call(&app, path, message))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string());
    }
    if zhiyan_core::s(&message, "op").starts_with("secret") {
        return tauri_plugin_zhiyan_credentials::handle(&app, &message).map_err(|e| e.to_string());
    }
    let export = zhiyan_core::s(&message, "op") == "export";
    let result =
        tauri::async_runtime::spawn_blocking(move || zhiyan_core::Core::open(path)?.call(message))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    if export {
        if let Some(path) = result["path"].as_str() {
            app.opener()
                .open_path(path, None::<&str>)
                .map_err(|e| format!("文件已导出，但打开失败：{e}"))?;
        }
    }
    Ok(result)
}

fn gateway_call(
    app: &tauri::AppHandle,
    path: PathBuf,
    message: Value,
) -> zhiyan_core::Result<Value> {
    static CONTROL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = CONTROL.lock().map_err(|_| "接口状态不可用")?;
    let mut core = zhiyan_core::Core::open(path)?;
    let op = zhiyan_core::s(&message, "op");
    if ["gatewayStatus", "gatewayStop"].contains(&op) {
        return core.call(serde_json::json!({"op":op}));
    }
    if cfg!(any(target_os = "ios", target_os = "android")) {
        return Err("请在 Mac 或 Windows 版开启对外接口".into());
    }
    let secret = |op: &str, key: &str, value: &str| {
        tauri_plugin_zhiyan_credentials::handle(
            app,
            &serde_json::json!({"op":op,"key":key,"value":value}),
        )
    };
    if op == "gatewayKey" {
        return secret("secretGet", "gateway.access", "");
    }
    if !["gatewayStart", "gatewayRotate"].contains(&op) {
        return Err("无效的接口操作".into());
    }
    let previous = secret("secretGet", "gateway.access", "")?
        .as_str()
        .unwrap_or("")
        .to_string();
    let mut key = previous.clone();
    if key.is_empty() || op == "gatewayRotate" {
        key = format!(
            "zy_{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        secret("secretSet", "gateway.access", &key)?;
    }
    if op == "gatewayRotate" {
        let result = core.call(serde_json::json!({"op":op,"key":key}));
        if result.is_err() && !previous.is_empty() {
            let _ = secret("secretSet", "gateway.access", &previous);
        }
        return result;
    }
    let mut body = serde_json::json!({"op":op,"config":message["config"],"key":key});
    if message["config"]["openai"] != false {
        let providers = core.meta("providers")?;
        if let Some(provider) = providers
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["enabled"] != false && zhiyan_core::s(p, "protocol") != "transcription")
        {
            body["provider"] = provider.clone();
            body["provider_key"] = secret(
                "secretGet",
                &format!("provider.{}", zhiyan_core::s(provider, "id")),
                "",
            )?;
        }
    }
    core.call(body)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_zhiyan_credentials::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("notes.db");
            zhiyan_core::Core::open(&path).map_err(|e| e.to_string())?;
            app.manage(AppData(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![native_call])
        .run(tauri::generate_context!())
        .expect("启动只言失败");
}
