//! 備份（ADR-023）：快照、群組匯入、清除舊表。
//! 前端的 plugin-sql 是連線池，BEGIN／COMMIT 可能落在不同連線，所以需要整批成功或整批失敗的操作在這裡用獨立連線做。

use rusqlite::{types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

fn open(path: &str) -> Result<Connection, String> {
    let c = Connection::open(path).map_err(|e| format!("開啟資料庫失敗：{e}"))?;
    c.busy_timeout(Duration::from_secs(15)).map_err(|e| e.to_string())?;
    Ok(c)
}

/// 只允許一般資料表名稱，避免拼接 SQL 時被注入
fn safe_name(t: &str) -> Result<&str, String> {
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(t)
    } else {
        Err(format!("資料表名稱不正確：{t}"))
    }
}

fn columns(c: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut st = c
        .prepare(&format!("PRAGMA table_info(\"{}\")", safe_name(table)?))
        .map_err(|e| e.to_string())?;
    let cols = st
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(cols)
}

fn table_exists(c: &Connection, table: &str) -> Result<bool, String> {
    c.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .map_err(|e| e.to_string())
}

/// 以 VACUUM INTO 產生一致的快照（含 WAL 裡的最新資料）；scrub 列出的表在快照中清空後再壓縮。
/// src 可以是正在使用的資料庫，也可以是另一份快照（另存時清除病人資料）。回傳檔案大小。
#[tauri::command(async)]
pub fn backup_snapshot(src: String, dest: String, scrub: Vec<String>) -> Result<u64, String> {
    if std::path::Path::new(&dest).exists() {
        return Err("目的檔案已存在".into());
    }
    let c = open(&src)?;
    c.execute("VACUUM INTO ?1", [&dest]).map_err(|e| format!("建立快照失敗：{e}"))?;
    drop(c);
    if !scrub.is_empty() {
        let d = open(&dest)?;
        for t in &scrub {
            if table_exists(&d, safe_name(t)?)? {
                d.execute(&format!("DELETE FROM \"{t}\""), []).map_err(|e| e.to_string())?;
            }
        }
        d.execute_batch("VACUUM").map_err(|e| e.to_string())?;
    }
    std::fs::metadata(&dest).map(|m| m.len()).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct ImportTable {
    table: String,
    /// "merge"：依主鍵新增或覆蓋；"replace"：先清空再寫入
    mode: String,
    rows: Vec<serde_json::Map<String, Value>>,
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// 群組匯入：整批包在一個交易裡，任何一筆失敗就全部不寫入。檔案中本機沒有的欄位會略過。回傳寫入筆數。
#[tauri::command(async)]
pub fn backup_import(db_path: String, tables: Vec<ImportTable>) -> Result<usize, String> {
    let mut c = open(&db_path)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for t in &tables {
        let name = safe_name(&t.table)?;
        let cols = columns(&tx, name)?;
        if cols.is_empty() {
            return Err(format!("本機沒有資料表 {name}"));
        }
        if t.mode == "replace" {
            tx.execute(&format!("DELETE FROM \"{name}\""), []).map_err(|e| e.to_string())?;
        }
        for row in &t.rows {
            let keys: Vec<&String> = row.keys().filter(|k| cols.contains(k)).collect();
            if keys.is_empty() {
                continue;
            }
            let sql = format!(
                "INSERT OR REPLACE INTO \"{name}\" ({}) VALUES ({})",
                keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(","),
                vec!["?"; keys.len()].join(",")
            );
            let vals: Vec<SqlValue> = keys.iter().map(|k| to_sql(&row[k.as_str()])).collect();
            tx.execute(&sql, rusqlite::params_from_iter(vals))
                .map_err(|e| format!("{name} 寫入失敗：{e}"))?;
            n += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(n)
}

/// 刪除沒有程式使用的舊表後壓縮資料庫
#[tauri::command(async)]
pub fn backup_drop_tables(db_path: String, tables: Vec<String>) -> Result<(), String> {
    let c = open(&db_path)?;
    for t in &tables {
        c.execute(&format!("DROP TABLE IF EXISTS \"{}\"", safe_name(t)?), [])
            .map_err(|e| e.to_string())?;
    }
    c.execute_batch("VACUUM").map_err(|e| format!("壓縮失敗：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("medbase_backup_test_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_file(&d);
        d.to_string_lossy().into_owned()
    }

    fn setup(name: &str) -> String {
        let p = tmp(&format!("{name}.db"));
        let c = Connection::open(&p).unwrap();
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE sets (id INTEGER PRIMARY KEY, uid TEXT UNIQUE, name TEXT NOT NULL);
             CREATE TABLE note_records (id INTEGER PRIMARY KEY, patient_name TEXT);
             CREATE TABLE icd_codes (code TEXT);
             INSERT INTO sets (uid, name) VALUES ('a', '甲'), ('b', '乙');
             INSERT INTO note_records (patient_name) VALUES ('王小明');
             INSERT INTO icd_codes VALUES ('A00');",
        )
        .unwrap();
        p
    }

    fn count(path: &str, t: &str) -> i64 {
        Connection::open(path).unwrap().query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn snapshot_and_scrub() {
        let db = setup("snap");
        let full = tmp("full.db");
        backup_snapshot(db.clone(), full.clone(), vec![]).unwrap();
        assert_eq!(count(&full, "sets"), 2);
        assert_eq!(count(&full, "note_records"), 1);
        assert!(backup_snapshot(db.clone(), full.clone(), vec![]).is_err(), "目的檔已存在要拒絕");
        let scrubbed = tmp("scrub.db");
        backup_snapshot(full.clone(), scrubbed.clone(), vec!["note_records".into()]).unwrap();
        assert_eq!(count(&scrubbed, "note_records"), 0);
        assert_eq!(count(&scrubbed, "sets"), 2);
    }

    fn rows(v: serde_json::Value) -> Vec<serde_json::Map<String, Value>> {
        v.as_array().unwrap().iter().map(|r| r.as_object().unwrap().clone()).collect()
    }

    #[test]
    fn import_merge_replace_and_rollback() {
        let db = setup("import");
        // 合併：uid a 覆蓋、c 新增，b 保留；未知欄位略過
        let n = backup_import(db.clone(), vec![ImportTable {
            table: "sets".into(), mode: "merge".into(),
            rows: rows(json!([{ "id": 1, "uid": "a", "name": "甲2", "extra": 1 }, { "id": 3, "uid": "c", "name": "丙" }])),
        }]).unwrap();
        assert_eq!(n, 2);
        assert_eq!(count(&db, "sets"), 3);
        // 失敗（name 不可為 NULL）時整批不寫入，連前面的 replace 也還原
        let err = backup_import(db.clone(), vec![
            ImportTable { table: "note_records".into(), mode: "replace".into(), rows: vec![] },
            ImportTable { table: "sets".into(), mode: "replace".into(), rows: rows(json!([{ "uid": "x", "name": null }])) },
        ]);
        assert!(err.is_err());
        assert_eq!(count(&db, "sets"), 3);
        assert_eq!(count(&db, "note_records"), 1);
        // 取代
        backup_import(db.clone(), vec![ImportTable { table: "sets".into(), mode: "replace".into(), rows: rows(json!([{ "uid": "z", "name": "丁" }])) }]).unwrap();
        assert_eq!(count(&db, "sets"), 1);
        // 不存在的表、不合法的名稱
        assert!(backup_import(db.clone(), vec![ImportTable { table: "nope".into(), mode: "merge".into(), rows: vec![] }]).is_err());
        assert!(backup_import(db.clone(), vec![ImportTable { table: "sets; DROP".into(), mode: "merge".into(), rows: vec![] }]).is_err());
    }

    #[test]
    fn drop_legacy() {
        let db = setup("drop");
        backup_drop_tables(db.clone(), vec!["icd_codes".into(), "not_there".into()]).unwrap();
        let c = Connection::open(&db).unwrap();
        assert!(!table_exists(&c, "icd_codes").unwrap());
        assert!(table_exists(&c, "sets").unwrap());
    }
}
