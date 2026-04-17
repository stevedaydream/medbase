import { getDb } from "@/db";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

interface PhysicianRow {
  name: string;
  his_account: string | null;
  his_password: string | null;
  phs_account: string | null;
  phs_password: string | null;
}

export interface PassAhkResult {
  content: string;
  hisCount: number;
  phsCount: number;
}

export async function buildPassAhkContent(): Promise<PassAhkResult | null> {
  const db = await getDb();
  const physicians = await db.select<PhysicianRow[]>(
    `SELECT name, his_account, his_password, phs_account, phs_password
     FROM physicians
     WHERE (his_account IS NOT NULL AND his_account != '')
        OR (phs_account IS NOT NULL AND phs_account != '')
     ORDER BY name`
  );
  if (!physicians.length) return null;

  const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  const his = physicians.filter(p => p.his_account);
  const phs = physicians.filter(p => p.phs_account);

  const lines: string[] = [
    "#Requires AutoHotkey v2",
    "#SingleInstance Force",
    "",
    "; ═══════════════════════════════════════════════════════",
    ";  pass.ahk — MedBase 自動產生的帳密熱字串",
    `;  產生時間：${now}`,
    ";  觸發格式：輸入 .<帳號> 自動展開為 帳號 {Tab} 密碼",
    ";  PHS 帳號前加 p，例如 .p帳號",
    "; ═══════════════════════════════════════════════════════",
    "",
  ];

  if (his.length) {
    lines.push("; ── HIS 帳密 " + "─".repeat(42));
    for (const p of his) {
      lines.push(`; ${p.name}`);
      lines.push(`:*:.${p.his_account}::`);
      lines.push(`{`);
      lines.push(`    SendText "${p.his_account}"`);
      lines.push(`    Send "{Tab}"`);
      if (p.his_password) lines.push(`    SendText "${p.his_password}"`);
      lines.push(`    Send "{Enter}"`);
      lines.push(`}`);
      lines.push("");
    }
  }

  if (phs.length) {
    lines.push("; ── PHS 帳密（前綴 p）" + "─".repeat(36));
    for (const p of phs) {
      if (!p.phs_account) continue;
      lines.push(`; ${p.name}`);
      lines.push(`:*:.p${p.phs_account}::`);
      lines.push(`{`);
      lines.push(`    SendText "${p.phs_account}"`);
      lines.push(`    Send "{Tab}"`);
      if (p.phs_password) lines.push(`    SendText "${p.phs_password}"`);
      lines.push(`    Send "{Enter}"`);
      lines.push(`}`);
      lines.push("");
    }
  }

  return { content: lines.join("\n"), hisCount: his.length, phsCount: phs.length };
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
 * 靜默同步：若使用者曾指定 pass_ahk_path → 重新產生並 Reload。
 * 未指定 → null（完全靜默）。
 * 已指定但出問題 → 回傳警告訊息讓呼叫方 toast。
 */
export async function autoUpdatePassAhk(): Promise<string | null> {
  const path = await getPassAhkPath();
  if (!path) return null; // 使用者從未設定，靜默跳過

  const result = await buildPassAhkContent();
  if (!result) return "pass.ahk 未更新：通訊錄中無帳號資料";

  try {
    await writeTextFile(path, result.content);
  } catch {
    return "pass.ahk 寫入失敗：請確認路徑存在且可寫入";
  }

  const db = await getDb();
  await db.execute(
    `UPDATE ahk_scripts SET updated_at = datetime('now') WHERE file_path = ?`, [path]
  );

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
