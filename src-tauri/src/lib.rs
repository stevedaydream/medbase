use encoding_rs::BIG5;
use regex::Regex;
use scraper::{Html, Selector};

#[tauri::command]
fn reload_ahk(exe_path: String, script_path: String) -> Result<(), String> {
    std::process::Command::new(&exe_path)
        .arg("/restart")
        .arg(&script_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────
// HIS 爬蟲共用結構體
// ──────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct HisPatient {
    pub account_no: String,
    pub chart_no: String,
    pub patient_name: Option<String>,
    pub bed_no: Option<String>,
    pub ward: Option<String>,
}

#[derive(serde::Serialize, Debug)]
pub struct HisScrapeResult {
    pub account_no: String,
    pub chart_no: String,
    pub note_text: String,
    pub raw_html: String,
    pub status: String,
    pub error_msg: Option<String>,
}

#[derive(serde::Serialize, Debug)]
pub struct HisLoginResult {
    pub success: bool,
    pub session_cookie: String,
    pub redirect_url: String,
}

// ──────────────────────────────────────────────────────────────────
// 輔助函式
// ──────────────────────────────────────────────────────────────────

/// 將 Big5 bytes 解碼為 UTF-8 String（若非 Big5 則直接 from_utf8_lossy）
fn decode_big5(bytes: &[u8]) -> String {
    let (cow, _, had_errors) = BIG5.decode(bytes);
    if !had_errors {
        return cow.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// 偵測回應是否為 session 過期（重新導向至登入頁）
fn is_session_expired(url: &str, body: &str) -> bool {
    url.contains("login") || url.contains("Login")
        || body.contains("請重新登入")
        || body.contains("session expired")
        || body.contains("Session Timeout")
        || body.contains("逾時")
}

/// 建立帶 cookie store 的 reqwest Client
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .cookie_store(true)
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())
}

/// 執行登入，回傳 (client, cookie_value, redirect_url, success)
async fn do_login(
    client: &reqwest::Client,
    base_url: &str,
    login_path: &str,
    username_field: &str,
    password_field: &str,
    username: &str,
    password: &str,
) -> Result<(String, String, bool), String> {
    let login_url = format!("{}{}", base_url, login_path);
    let params = [
        (username_field, username),
        (password_field, password),
    ];
    let resp = client
        .post(&login_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let final_url = resp.url().to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let body = decode_big5(&bytes);

    let success = !is_session_expired(&final_url, &body)
        && !body.contains("登入失敗")
        && !body.contains("帳號或密碼")
        && !body.contains("密碼錯誤");

    // 嘗試從 Set-Cookie 取得 JSESSIONID（已由 cookie_store 自動管理，這裡只是回傳給 UI 顯示）
    let cookie_val = String::from("(managed by cookie store)");

    Ok((cookie_val, final_url, success))
}

// ──────────────────────────────────────────────────────────────────
// 命令 1：測試登入
// ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn his_test_login(
    base_url: String,
    login_path: String,
    username_field: String,
    password_field: String,
    username: String,
    password: String,
) -> Result<HisLoginResult, String> {
    let client = build_client()?;
    let (cookie, redirect_url, success) = do_login(
        &client, &base_url, &login_path,
        &username_field, &password_field,
        &username, &password,
    ).await?;

    Ok(HisLoginResult { success, session_cookie: cookie, redirect_url })
}

// ──────────────────────────────────────────────────────────────────
// 命令 2：原始 HTML 探索（用於找病人清單端點）
// ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn his_raw_fetch(
    base_url: String,
    login_path: String,
    username_field: String,
    password_field: String,
    username: String,
    password: String,
    fetch_path: String,
    fetch_params: String,
) -> Result<String, String> {
    let client = build_client()?;
    do_login(&client, &base_url, &login_path, &username_field, &password_field, &username, &password).await?;

    let full_url = format!("{}{}{}", base_url, fetch_path, fetch_params);
    let resp = client.get(&full_url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let body = decode_big5(&bytes);

    // 截斷至 10000 chars 以免 UI 爆炸
    Ok(body.chars().take(10000).collect())
}

// ──────────────────────────────────────────────────────────────────
// 命令 3：從 HIS 抓病人清單
// ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn his_fetch_patient_list(
    base_url: String,
    login_path: String,
    username_field: String,
    password_field: String,
    username: String,
    password: String,
    list_path: String,
    list_params: String,
) -> Result<Vec<HisPatient>, String> {
    let client = build_client()?;
    let (_, _, success) = do_login(
        &client, &base_url, &login_path,
        &username_field, &password_field,
        &username, &password,
    ).await?;
    if !success {
        return Err("登入失敗：帳號或密碼不正確".into());
    }

    let full_url = format!("{}{}{}", base_url, list_path, list_params);
    let resp = client.get(&full_url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let body = decode_big5(&bytes);

    // 解析 HTML table，取 <tr> 中的前兩個 <td> 作為 account_no / chart_no
    let doc = Html::parse_document(&body);
    let row_sel = Selector::parse("tbody tr, table tr").unwrap();
    let td_sel  = Selector::parse("td").unwrap();

    let mut patients: Vec<HisPatient> = Vec::new();
    for row in doc.select(&row_sel) {
        let tds: Vec<String> = row.select(&td_sel)
            .map(|td| td.text().collect::<String>().trim().to_string())
            .collect();
        if tds.len() >= 2 && !tds[0].is_empty() && !tds[1].is_empty() {
            patients.push(HisPatient {
                account_no: tds[0].clone(),
                chart_no:   tds[1].clone(),
                patient_name: tds.get(2).cloned(),
                bed_no:       tds.get(3).cloned(),
                ward:         tds.get(4).cloned(),
            });
        }
    }
    Ok(patients)
}

// ──────────────────────────────────────────────────────────────────
// 命令 4：批次爬取病歷摘要（主要功能）
// ──────────────────────────────────────────────────────────────────

/// 從 noteTotalView HTML 解析 historyTB 中每列的 doChooseHistory 參數
fn parse_history_entries(html: &str) -> Vec<(String, String, String, String, String, String, String)> {
    // doChooseHistory('0','I11500020363','20260503','Ins010203','','','','')
    let re = Regex::new(
        r"doChooseHistory\('(\d+)','([^']+)','([^']*)','([^']+)','([^']*)','([^']*)','([^']*)','([^']*)'\)"
    ).unwrap();

    // 並行取得筆記類型標籤（從 <td> 文字）
    let doc = Html::parse_document(html);
    let row_sel  = Selector::parse("#historyTB tbody tr").unwrap();
    let td_sel   = Selector::parse("td").unwrap();
    let label_sel = Selector::parse("label").unwrap();

    let mut results = Vec::new();
    for row in doc.select(&row_sel) {
        let onclick = row.value().attr("onclick").unwrap_or("").to_string();
        if let Some(caps) = re.captures(&onclick) {
            let acc_no  = caps[2].to_string();
            let c_date  = caps[3].to_string();
            let program = caps[4].to_string();
            let key1    = caps[5].to_string();
            let key2    = caps[6].to_string();
            let key3    = caps[7].to_string();
            let key4    = caps[8].to_string();

            // 取筆記類型文字（過濾掉隱藏的 <label>）
            let note_type = row.select(&td_sel)
                .nth(1)
                .map(|td| {
                    // 排除 <label style="display:none"> 的文字
                    let label_text: String = td.select(&label_sel)
                        .map(|l| l.text().collect::<String>())
                        .collect();
                    let full_text: String = td.text().collect::<String>();
                    full_text.replace(&label_text, "").trim().to_string()
                })
                .unwrap_or_default();

            results.push((acc_no, c_date, program, key1, key2, key3, note_type));
            // note: key4 ignored in tuple but used in POST below via caps
            let _ = key4;
        }
    }

    // 若 scraper 解析失敗（格式不符），回退至純 regex 掃描
    if results.is_empty() {
        for caps in re.captures_iter(html) {
            results.push((
                caps[2].to_string(),
                caps[3].to_string(),
                caps[4].to_string(),
                caps[5].to_string(),
                caps[6].to_string(),
                caps[7].to_string(),
                String::new(),
            ));
        }
    }
    results
}

/// 從 historyTB HTML 解析含 key4 的完整參數
fn parse_history_entries_full(html: &str) -> Vec<[String; 8]> {
    let re = Regex::new(
        r"doChooseHistory\('(\d+)','([^']+)','([^']*)','([^']+)','([^']*)','([^']*)','([^']*)','([^']*)'\)"
    ).unwrap();
    re.captures_iter(html)
        .map(|caps| [
            caps[1].to_string(), // index
            caps[2].to_string(), // accNo
            caps[3].to_string(), // cDate
            caps[4].to_string(), // program
            caps[5].to_string(), // key1
            caps[6].to_string(), // key2
            caps[7].to_string(), // key3
            caps[8].to_string(), // key4
        ])
        .collect()
}

/// 取得一筆筆記的純文字內容
async fn fetch_note_text(
    client: &reqwest::Client,
    base_url: &str,
    account_no: &str,
    chart_no: &str,
    entry: &[String; 8],
) -> Result<String, String> {
    let program = &entry[3];
    let c_date  = &entry[2];
    let key1    = &entry[4];
    let key2    = &entry[5];
    let key3    = &entry[6];
    let key4    = &entry[7];

    if program == "Ibl0501" {
        // 會診：使用 IblAjaxUtil/query 端點
        let url = format!("{}/servlet/HttpDispatcher/IblAjaxUtil/query", base_url);
        let params = [
            ("accountNo", account_no),
            ("chartNo",   chart_no),
            ("cDate",     c_date.as_str()),
            ("program",   program.as_str()),
            ("key1",      key1.as_str()),
            ("key2",      key2.as_str()),
            ("key3",      key3.as_str()),
            ("key4",      key4.as_str()),
            ("divisionNo","004"),
            ("TxFlag",    "Digest"),
            ("SQLKEY",    "cathay.hospital.ibl.module.Ibl0501_UI.QUERY_ConsultNote"),
        ];
        let resp = client.post(&url).form(&params).send().await.map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(results) = json["result"].as_array() {
            let mut lines = Vec::new();
            for r in results {
                let get = |k: &str| r[k].as_str().unwrap_or("").to_string();
                let date_raw = get("CONSULTDATE");
                let date_fmt = if date_raw.len() == 8 {
                    format!("{}/{}/{}", &date_raw[..4], &date_raw[4..6], &date_raw[6..])
                } else { date_raw };
                let time_raw = get("CONSULTTIME");
                let time_fmt = if time_raw.len() >= 4 {
                    format!("{}:{}", &time_raw[..2], &time_raw[2..4])
                } else { time_raw };
                lines.push(format!(
                    "會診科別：{}\n會診類別：{}\n會診時間：{} {}\n【病況簡介】\n{}\n【會診目的】\n{}\n【會診報告－{}醫師】\n{}",
                    get("COSTNAME"), get("CONSULTNAME"), date_fmt, time_fmt,
                    get("MALADY"), get("CONSULTGOAL"), get("DRNAME"), get("CONSULTREPORT")
                ));
            }
            return Ok(lines.join("\n\n"));
        }
        return Ok(String::new());
    }

    // 一般筆記：POST /{program}/viewNote
    let url = format!("{}/servlet/HttpDispatcher/{}/viewNote", base_url, program);
    let params = [
        ("accountNo", account_no),
        ("chartNo",   chart_no),
        ("cDate",     c_date.as_str()),
        ("program",   program.as_str()),
        ("key1",      key1.as_str()),
        ("key2",      key2.as_str()),
        ("key3",      key3.as_str()),
        ("key4",      key4.as_str()),
    ];
    let resp = client.post(&url).form(&params).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json["ErrMsg"].as_object() {
        if let Some(msg) = err.get("msgDescs").and_then(|v| v.as_str()) {
            if !msg.is_empty() {
                return Err(msg.to_string());
            }
        }
    }
    Ok(json["NoteData"].as_str().unwrap_or("").to_string())
}

#[tauri::command]
async fn his_scrape_batch(
    base_url: String,
    login_path: String,
    username_field: String,
    password_field: String,
    username: String,
    password: String,
    note_view_path: String,
    logout_path: String,
    patients: Vec<HisPatient>,
) -> Result<Vec<HisScrapeResult>, String> {
    let client = build_client()?;

    let (_, _, success) = do_login(
        &client, &base_url, &login_path,
        &username_field, &password_field,
        &username, &password,
    ).await?;
    if !success {
        return Err("登入失敗：帳號或密碼不正確".into());
    }

    let mut results: Vec<HisScrapeResult> = Vec::new();
    let mut session_expired = false;

    for patient in &patients {
        if session_expired {
            results.push(HisScrapeResult {
                account_no: patient.account_no.clone(),
                chart_no:   patient.chart_no.clone(),
                note_text:  String::new(),
                raw_html:   String::new(),
                status:     "session_expired".into(),
                error_msg:  Some("Session 已過期，請重新擷取".into()),
            });
            continue;
        }

        // ── 第一階段：GET noteTotalView ──
        let note_url = format!(
            "{}{}?accountNo={}&chartNo={}&view=Y",
            base_url, note_view_path, patient.account_no, patient.chart_no
        );
        let shell_resp = match client.get(&note_url).send().await {
            Ok(r) => r,
            Err(e) => {
                results.push(HisScrapeResult {
                    account_no: patient.account_no.clone(),
                    chart_no:   patient.chart_no.clone(),
                    note_text:  String::new(),
                    raw_html:   String::new(),
                    status:     "error".into(),
                    error_msg:  Some(e.to_string()),
                });
                continue;
            }
        };

        let final_url = shell_resp.url().to_string();
        let bytes = shell_resp.bytes().await.unwrap_or_default();
        let raw_html = decode_big5(&bytes);

        if is_session_expired(&final_url, &raw_html) {
            session_expired = true;
            results.push(HisScrapeResult {
                account_no: patient.account_no.clone(),
                chart_no:   patient.chart_no.clone(),
                note_text:  String::new(),
                raw_html:   raw_html.chars().take(2000).collect(),
                status:     "session_expired".into(),
                error_msg:  Some("Session 已過期".into()),
            });
            continue;
        }

        // ── 第二階段：AJAX POST 取得每筆筆記內容 ──
        let entries = parse_history_entries_full(&raw_html);

        // 同時解析筆記類型名稱（第 7 欄位來自 parse_history_entries）
        let type_names = parse_history_entries(&raw_html);

        let mut note_parts: Vec<String> = Vec::new();
        let mut had_error = false;
        let mut error_msgs: Vec<String> = Vec::new();

        for (i, entry) in entries.iter().enumerate() {
            let note_type = type_names.get(i)
                .map(|t| t.6.clone())
                .unwrap_or_else(|| entry[3].clone());
            let c_date = &entry[2];

            match fetch_note_text(&client, &base_url, &patient.account_no, &patient.chart_no, entry).await {
                Ok(text) if !text.is_empty() => {
                    let header = if c_date.is_empty() {
                        format!("=== {} ===", note_type)
                    } else {
                        format!("=== {} ({}) ===", note_type, c_date)
                    };
                    note_parts.push(format!("{}\n{}", header, text));
                }
                Ok(_) => {}
                Err(e) => {
                    had_error = true;
                    error_msgs.push(format!("{}: {}", note_type, e));
                }
            }
        }

        results.push(HisScrapeResult {
            account_no: patient.account_no.clone(),
            chart_no:   patient.chart_no.clone(),
            note_text:  note_parts.join("\n\n"),
            raw_html:   raw_html.chars().take(5000).collect(),
            status:     if had_error && note_parts.is_empty() { "error".into() }
                        else if had_error { "partial".into() }
                        else { "ok".into() },
            error_msg:  if error_msgs.is_empty() { None } else { Some(error_msgs.join("; ")) },
        });
    }

    // 登出
    let _ = client.get(format!("{}{}", base_url, logout_path)).send().await;

    Ok(results)
}

// ──────────────────────────────────────────────────────────────────

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
            his_test_login,
            his_raw_fetch,
            his_fetch_patient_list,
            his_scrape_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
