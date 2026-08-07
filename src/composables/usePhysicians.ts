import { getDb, dbWrite } from "@/db";
import { autoUpdatePassAhk } from "@/composables/usePassAhk";
import { markLocalModified, pushTableToCloud } from "@/composables/useSyncMonitor";
import { exportToXlsx, autoCloudSync, xlsxPath } from "@/composables/useXlsxSync";
import { useCloudSettings } from "@/stores/cloudSettings";

/**
 * physicians 表的唯一寫入入口。
 *
 * 過去 INSERT/UPDATE/DELETE 手抄在 PhysiciansView、DataManageView、
 * ContactsView、SetsView 四處，副作用（pass.ahk 重建、同步標記、雲端
 * 推送、xlsx 匯出）必須逐處複製 —— 刪除那條路徑就漏了全部四項，導致
 * 已移除醫師的 HIS 帳密繼續留在磁碟上的 pass.ahk。集中在此後不會再漏。
 */

export interface Physician {
  id: number;
  name: string;
  department: string | null;
  title: string | null;
  ext: string | null;
  his_account: string | null;
  his_password: string | null;
  notes: string | null;
}

export type PhysicianForm = Partial<Omit<Physician, "id">> & { id?: number };

export interface WriteResult {
  /** 給呼叫方 toast 的 pass.ahk 訊息；null 表示使用者未設定路徑，應保持靜默 */
  ahkMessage: string | null;
}

/** 寫入後的共同副作用，順序與原本 savePhysician 一致 */
async function afterWrite(): Promise<string | null> {
  const ahkMessage = await autoUpdatePassAhk();
  await markLocalModified("physicians");

  if (xlsxPath.value) {
    exportToXlsx();
    autoCloudSync();
  }

  const gasUrl = useCloudSettings().gasUrl;
  if (gasUrl) {
    const db = await getDb();
    const all = await db.select<Physician[]>("SELECT * FROM physicians");
    pushTableToCloud(
      "physicians",
      gasUrl,
      { action: "savePhysicians", data: all },
      all.length,
    ).catch(() => {});
  }

  return ahkMessage;
}

/**
 * pass.ahk 只收錄有 HIS 帳號的人。沒填帳號時原本完全靜默，看起來像
 * 「按了沒反應」，這裡改為明講原因。base 為 null 代表使用者從未指定
 * pass.ahk 路徑，維持完全靜默。
 */
function missingAccountNotice(f: PhysicianForm, base: string | null): string | null {
  if (base === null) return null;
  if (!f.his_account?.trim()) {
    return `${f.name ?? "此筆資料"} 無 HIS 帳號，未寫入 pass.ahk`;
  }
  return base;
}

/** 新增（無 id）或更新（有 id）一筆醫師資料 */
export async function upsertPhysician(f: PhysicianForm): Promise<WriteResult> {
  const name = f.name?.trim();
  if (!name) throw new Error("姓名為必填");

  if (f.id) {
    await dbWrite(
      `UPDATE physicians
          SET name=?, department=?, title=?, ext=?,
              his_account=?, his_password=?, notes=?,
              updated_at=datetime('now','localtime')
        WHERE id=?`,
      [name, f.department || null, f.title || null, f.ext || null,
       f.his_account || null, f.his_password || null, f.notes || null, f.id],
    );
  } else {
    await dbWrite(
      `INSERT INTO physicians
         (name, department, title, ext, his_account, his_password, notes, updated_at)
       VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))`,
      [name, f.department || null, f.title || null, f.ext || null,
       f.his_account || null, f.his_password || null, f.notes || null],
    );
  }

  return { ahkMessage: missingAccountNotice(f, await afterWrite()) };
}

/** 刪除一筆醫師資料，並跑完整副作用（含把帳密從 pass.ahk 移除） */
export async function removePhysician(id: number): Promise<WriteResult> {
  // 先解除套組對此醫師的 FK 參照，否則 SQLite 會噴
  // FOREIGN KEY constraint failed (code 787)
  await dbWrite("UPDATE sets SET physician_id = NULL WHERE physician_id = ?", [id]);
  await dbWrite("DELETE FROM physicians WHERE id=?", [id]);
  return { ahkMessage: await afterWrite() };
}
