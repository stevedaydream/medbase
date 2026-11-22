mod backup;

/// 電腦名稱（垃圾桶記錄在哪一台刪除，ADR-028）
#[tauri::command]
fn machine_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default()
}

#[tauri::command]
fn reload_ahk(exe_path: String, script_path: String) -> Result<(), String> {
    std::process::Command::new(&exe_path)
        .arg("/restart")
        .arg(&script_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 從命令列取出 .ahk 腳本路徑（支援引號包住含空白的路徑）
fn ahk_script_of(cmdline: &str) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in cmdline.chars() {
        match c {
            '"' => quoted = !quoted,
            ' ' | '\t' if !quoted => {
                if !cur.is_empty() { tokens.push(std::mem::take(&mut cur)); }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() { tokens.push(cur); }
    tokens.into_iter().skip(1).find(|t| t.to_lowercase().ends_with(".ahk"))
}

fn norm_path(p: &str) -> String {
    p.replace('/', "\\").trim().to_lowercase()
}

/// 執行中的 AutoHotkey 腳本：(PID, 腳本路徑)。只列出命令列帶 .ahk 的程序（編譯成 exe 的腳本抓不到）
#[cfg(windows)]
fn running_ahk() -> Result<Vec<(u32, String)>, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter \"Name LIKE 'AutoHotkey%'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter_map(|l| {
            let (pid, cmd) = l.split_once('\t')?;
            Some((pid.trim().parse().ok()?, ahk_script_of(cmd)?))
        })
        .collect())
}

/// 關掉 keep 以外所有執行中的 AHK 腳本，回傳被關掉的腳本路徑。
/// keep 為完整路徑；不含路徑分隔符號的項目（例如 "pass.ahk"）以檔名比對
#[tauri::command]
fn close_other_ahk(keep: Vec<String>) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let keep: Vec<String> = keep.iter().map(|k| norm_path(k)).collect();
        let mut closed = Vec::new();
        for (pid, script) in running_ahk()? {
            let full = norm_path(&script);
            let name = full.rsplit('\\').next().unwrap_or(&full).to_string();
            if keep.iter().any(|k| *k == full || (!k.contains('\\') && *k == name)) { continue; }
            let ok = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok { closed.push(script); }
        }
        Ok(closed)
    }
    #[cfg(not(windows))]
    {
        let _ = keep;
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_ahk_cmdline() {
        assert_eq!(
            ahk_script_of(r#""C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" /restart "C:\Users\a b\RoyRoy.ahk""#).as_deref(),
            Some(r"C:\Users\a b\RoyRoy.ahk")
        );
        assert_eq!(ahk_script_of(r"AutoHotkey64.exe D:\x\pass.AHK").as_deref(), Some(r"D:\x\pass.AHK"));
        assert_eq!(ahk_script_of(r#""C:\AutoHotkey64.exe""#), None);
        assert_eq!(norm_path("C:/A/Pass.ahk"), norm_path(r"c:\a\pass.AHK"));
    }
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
        .invoke_handler(tauri::generate_handler![
            reload_ahk,
            close_other_ahk,
            machine_name,
            backup::backup_snapshot,
            backup::backup_import,
            backup::backup_drop_tables,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
