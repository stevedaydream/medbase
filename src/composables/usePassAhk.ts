import { getDb } from "@/db";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

interface PhysicianRow {
  name: string;
  his_account: string | null;
  his_password: string | null;
}

export interface PassAhkResult {
  content: string;
  hisCount: number;
}

export async function buildPassAhkContent(): Promise<PassAhkResult | null> {
  const db = await getDb();
  const physicians = await db.select<PhysicianRow[]>(
    `SELECT name, his_account, his_password
     FROM physicians
     WHERE his_account IS NOT NULL AND his_account != ''
     ORDER BY name`
  );
  if (!physicians.length) return null;

  const his = physicians;

  // 內容必須是「相同資料就產生相同位元組」，autoUpdatePassAhk 才能靠比對
  // 略過無謂的寫檔與 Reload。產生時間會讓每次結果都不同，故不寫進檔案，
  // 需要時看檔案的修改時間或 ahk_scripts.updated_at。
  const lines: string[] = [
    "#Requires AutoHotkey v2",
    "#SingleInstance Force",
    // 一次展開約 0.5 秒；預設只允許 1 個執行緒，連續輸入時第二組會被丟掉。
    "#MaxThreadsPerHotkey 3",
    "",
    "; ═══════════════════════════════════════════════════════",
    ";  pass.ahk — MedBase 自動產生的帳密熱字串",
    ";  觸發格式：輸入 .<帳號> 自動展開為 帳號 {Tab} 密碼",
    "; ═══════════════════════════════════════════════════════",
    "",
  ];

  // 送鍵組態是實測出來的（見 BF-017）：院內電腦有低階鍵盤鉤子會吃掉 SendInput
  // 注入的按鍵，退格與內文都會隨機掉字，SendPlay 則完全被擋。
  //   B0        關掉自動退格。這是關鍵 —— 自動退格不吃 SendMode，只設檔頭
  //             的 SendMode "Event" 沒用，退格照樣走被攔截的 SendInput
  //   Z         觸發後重置辨識器。Event 模式會把自己送出的帳密與退格餵回
  //             辨識緩衝區，少了 Z 則第二次展開必定失敗，要按 Backspace
  //             把緩衝區推回可比對的狀態才會恢復
  //   SendEvent 唯一穿得過那個鉤子的機制，且必須在區塊內設定
  //   20ms      10～40ms 實測皆可，取 20 留一倍餘裕
  //   Sleep 100 等使用者實體按下的字全部落地，再開始退格
  if (his.length) {
    lines.push("; ── HIS 帳密 " + "─".repeat(42));
    for (const p of his) {
      const trigger = `.${p.his_account}`;
      lines.push(`; ${p.name}`);
      lines.push(`:*B0Z:${trigger}::`);
      lines.push(`{`);
      lines.push(`    SendMode "Event"`);
      lines.push(`    SetKeyDelay 20, 20`);
      lines.push(`    Sleep 100`);
      lines.push(`    Send "{BS ${trigger.length}}"`);
      lines.push(`    SendText "${p.his_account}"`);
      lines.push(`    Send "{Tab}"`);
      if (p.his_password) lines.push(`    SendText "${p.his_password}"`);
      lines.push(`    Send "{Enter}"`);
      lines.push(`}`);
      lines.push("");
    }
  }

  return { content: lines.join("\n"), hisCount: his.length };
}

export async function getPassAhkPath(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM app_settings WHERE key = 'pass_ahk_path'`
  );
  return rows[0]?.value || null;
}

export async function setPassAhkPath(path: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pass_ahk_path', ?)`, [path]
  );
}

/**
 * 靜默同步：若使用者曾指定 pass_ahk_path → 重新產生並（視 reload）重載。
 * 未指定、或內容與磁碟上完全相同 → null（完全靜默，不寫檔不 Reload）。
 * 已指定但出問題 → 回傳警告訊息讓呼叫方 toast。
 *
 * reload 預設 true。背景／批次情境應傳 false：Reload 會以
 * #SingleInstance Force 重啟 AHK，交接瞬間新舊實例並存，若正好撞上
 * 使用者在 HIS 打字，熱字串的退格會被吃掉，殘留 .38 之類的前綴。
 */
export async function autoUpdatePassAhk(
  opts: { reload?: boolean } = {},
): Promise<string | null> {
  const { reload = true } = opts;
  const path = await getPassAhkPath();
  if (!path) return null; // 使用者從未設定，靜默跳過

  const result = await buildPassAhkContent();
  if (!result) return "pass.ahk 未更新：通訊錄中無帳號資料";

  // 內容一字不差就別動它。多台機器指向同一個共享檔時，這同時避免了
  // 彼此無謂的覆蓋。
  let current: string | null = null;
  try { current = await readTextFile(path); } catch { /* 讀不到就當作需要寫入 */ }
  if (current === result.content) return null;

  try {
    await writeTextFile(path, result.content);
  } catch {
    return "pass.ahk 寫入失敗：請確認路徑存在且可寫入";
  }

  const db = await getDb();
  await db.execute(
    `UPDATE ahk_scripts SET updated_at = datetime('now') WHERE file_path = ?`, [path]
  );

  if (!reload) return "pass.ahk 已更新（未 Reload，請至 AHK 管理按刷新）";

  const exeRow = await db.select<{ value: string }[]>(
    `SELECT value FROM app_settings WHERE key = 'ahk_exe_path'`
  );
  const exePath = exeRow[0]?.value;
  if (exePath) {
    try {
      await invoke("reload_ahk", { exePath, scriptPath: path });
      return "pass.ahk 已同步並 Reload ✓";
    } catch {
      return "pass.ahk 已更新（Reload 失敗）";
    }
  }
  return "pass.ahk 已同步更新";
}
