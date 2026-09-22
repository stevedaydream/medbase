import { getDb, dbWrite } from "@/db";
import { autoUpdatePassAhk, getPassAhkPath } from "@/composables/usePassAhk";
import { markLocalModified } from "@/composables/useSyncMonitor";
import { exportToXlsx, xlsxPath } from "@/composables/useXlsxSync";
import { useCloudSettings } from "@/stores/cloudSettings";
import { useLogger } from "@/composables/useLogger";
import { syncTable, markDeleted, NoBaselineError } from "@/composables/useTableSync";

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
  phs_account?: string | null;
  phs_password?: string | null;
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

  if (xlsxPath.value) exportToXlsx();

  // 逐筆同步，不再整份覆蓋雲端（多台電腦並用會互相蓋掉，見 useTableSync）
  const gasUrl = useCloudSettings().gasUrl;
  if (gasUrl) {
    syncTable("physicians", gasUrl).catch((e) => {
      if (e instanceof NoBaselineError) useLogger().addLog("info", "[雲端同步] 通訊錄尚未建立同步基準，暫停自動同步");
      else useLogger().addLog("warn", "[雲端同步] 通訊錄同步失敗", String(e));
    });
  }

  return ahkMessage;
}

/**
 * pass.ahk 只收錄有 HIS 帳號的人。沒填帳號時原本完全靜默，看起來像
 * 「按了沒反應」，這裡改為明講原因。
 *
 * 是否靜默取決於使用者有沒有指定 pass.ahk 路徑，必須直接問 getPassAhkPath()。
 * 不能用 base === null 推斷 —— autoUpdatePassAhk 在「內容無變更」時也回 null，
 * 而新增一位沒有 HIS 帳號的醫師正好就是這種情形，那樣會把提示吃掉。
 */
async function missingAccountNotice(f: PhysicianForm, base: string | null): Promise<string | null> {
  if ((await getPassAhkPath()) === null) return null;
  if (!f.his_account?.trim()) {
    return `${f.name ?? "此筆資料"} 無 HIS 帳號，未寫入 pass.ahk`;
  }
  return base;
}

/**
 * 批次寫入（雲端拉取、XLSX 匯入、備份還原）之後重建 pass.ahk 並 Reload。
 *
 * 刻意不走 afterWrite()：那會 markLocalModified 並觸發雲端同步，
 * 但這些情境的資料正是剛從雲端／檔案拉進來的，再同步一次是多餘的。
 * 此處只做本機端的 pass.ahk 重建。
 */
export async function refreshPassAhk(): Promise<string | null> {
  // 這些情境多半在背景發生，不能順手 Reload —— 見 autoUpdatePassAhk 的說明。
  // 需要立即生效請用 AHK 管理頁 pass.ahk 的刷新鈕。
  return await autoUpdatePassAhk({ reload: false });
}

/** 新增（無 id）或更新（有 id）一筆醫師資料 */
export async function upsertPhysician(f: PhysicianForm): Promise<WriteResult> {
  const name = f.name?.trim();
  if (!name) throw new Error("姓名為必填");

  if (f.id) {
    // 改名在其他電腦看來是「舊名刪除、新名新增」，舊名要留刪除紀錄
    const db = await getDb();
    const old = await db.select<{ name: string }[]>("SELECT name FROM physicians WHERE id = ?", [f.id]);
    if (old[0] && old[0].name !== name) await markDeleted("physicians", old[0].name);
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

  return { ahkMessage: await missingAccountNotice(f, await afterWrite()) };
}

/** 刪除一筆醫師資料，並跑完整副作用（含把帳密從 pass.ahk 移除） */
export async function removePhysician(id: number): Promise<WriteResult> {
  // 先解除套組對此醫師的 FK 參照，否則 SQLite 會噴
  // FOREIGN KEY constraint failed (code 787)
  await dbWrite("UPDATE sets SET physician_id = NULL WHERE physician_id = ?", [id]);
  const db = await getDb();
  const row = await db.select<{ name: string }[]>("SELECT name FROM physicians WHERE id = ?", [id]);
  if (row[0]) await markDeleted("physicians", row[0].name);
  await dbWrite("DELETE FROM physicians WHERE id=?", [id]);
  return { ahkMessage: await afterWrite() };
}
