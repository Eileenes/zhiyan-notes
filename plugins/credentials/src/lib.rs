use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
#[cfg(target_os = "android")]
struct AndroidStore<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("zhiyan-credentials")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle =
                    _api.register_android_plugin("com.zhiyan.credentials", "CredentialsPlugin")?;
                _app.manage(AndroidStore(handle));
            }
            Ok(())
        })
        .build()
}
pub fn handle<R: Runtime>(_app: &tauri::AppHandle<R>, m: &Value) -> Result<Value> {
    let key = m["key"].as_str().unwrap_or("");
    let op = m["op"].as_str().unwrap_or("");
    if key.len() > 150 || !(key.starts_with("provider.") || key.starts_with("sync.") || key == "gateway.access") {
        return Err("无效的凭据名称".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let store = _app.state::<AndroidStore<R>>();
        let out: Value = store.0.run_mobile_plugin("handle", m.clone())?;
        return Ok(out["value"].clone());
    }
    #[cfg(not(target_os = "android"))]
    {
        let entry = keyring::Entry::new("com.duketao.zhiyan.credentials", key)?;
        match op {
            "secretGet" => match entry.get_password() {
                Ok(v) => Ok(json!(v)),
                Err(keyring::Error::NoEntry) => Ok(json!("")),
                Err(e) => Err(e.into()),
            },
            "secretSet" => {
                let value = m["value"].as_str().ok_or("凭据不能为空")?;
                if value.is_empty() || value.len() > 8192 {
                    return Err("凭据不能为空或过长".into());
                }
                entry.set_password(value)?;
                Ok(json!(true))
            }
            "secretDelete" => {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(e) => return Err(e.into()),
                }
                Ok(json!(true))
            }
            _ => Err("无效的凭据操作".into()),
        }
    }
}
