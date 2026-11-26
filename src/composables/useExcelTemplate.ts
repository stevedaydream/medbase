/**
 * Excel 排班範本：Excel 的「存範本到雲端」把整份活頁簿存到 GAS（Templates 工作表），
 * 這裡列出各版本，下載成一份可操作的 .xlsm 副本（換電腦時用）。
 */
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { gasUrl } from "@/composables/useSchedSync";

export interface ExcelTemplate { id: string; name: string; saved_at: string; by: string; size: number }

async function post<T>(body: object): Promise<T> {
  const url = await gasUrl();
  if (!url) throw new Error("請先在設定填入 GAS Web App URL");
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json() as T & { ok: boolean; error?: string };
  if (!j.ok) throw new Error(j.error ?? "GAS 錯誤");
  return j;
}

export async function listExcelTemplates(): Promise<ExcelTemplate[]> {
  return (await post<{ templates: ExcelTemplate[] }>({ action: "tplList" })).templates;
}

export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 預設檔名：範本名稱＋下載日期，例如 9A值班表_20261127.xlsm */
export function templateFileName(name: string, now = new Date()): string {
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  return `${safe}_${d}.xlsm`;
}

/** 下載一份範本；使用者取消存檔時回傳 null */
export async function downloadExcelTemplate(t: ExcelTemplate): Promise<string | null> {
  const path = await saveDialog({
    title: "儲存 Excel 排班表副本",
    defaultPath: templateFileName(t.name),
    filters: [{ name: "Excel 啟用巨集的活頁簿", extensions: ["xlsm"] }],
  });
  if (!path) return null;
  const r = await post<{ data: string }>({ action: "tplGet", id: t.id });
  await writeFile(path, base64Bytes(r.data));
  return path;
}
