#[tauri::command]
fn reload_ahk(exe_path: String, script_path: String) -> Result<(), String> {
    std::process::Command::new(&exe_path)
        .arg("/restart")
        .arg(&script_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![reload_ahk])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
