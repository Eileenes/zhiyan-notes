use std::io::{self, BufRead};
fn main() {
    let path = std::env::args().nth(1).expect("database path required");
    for line in io::stdin().lock().lines() {
        let result = (|| -> zhiyan_core::Result<serde_json::Value> {
            let m = serde_json::from_str(&line?)?;
            zhiyan_core::Core::open(&path)?.call(m)
        })();
        let value = match result {
            Ok(v) => serde_json::json!({"ok":true,"data":v}),
            Err(e) => serde_json::json!({"ok":false,"error":e.to_string()}),
        };
        println!("{value}");
    }
}
