/**
 * 排班 v3 登入工作階段：通訊錄 HIS 帳號＋HIS 密碼（本機比對，離線可用）。
 * 角色取自人員主檔；尚未建立人員時可用舊系統的 super 帳號（super／原密碼）啟動。
 * 登入狀態只存在記憶體，關閉 app 即登出。
 */
import { reactive, readonly } from "vue";
import { getDb, dbWrite } from "@/db";
import { sha256 } from "@/utils/sha256";
import type { Role } from "@/shared/sched/types";

const state = reactive({
  loggedIn: false,
  personId: null as string | null,
  his: "",
  name: "",
  role: "employee" as Role,
});

export function useSchedSession() {
  return readonly(state);
}

export interface LoginPerson { id: string; his: string; name: string; role: Role; active: boolean }

/** people：人員主檔（由呼叫端傳入，避免與 useSchedStore 互相引用） */
export async function schedLogin(his: string, password: string, people: LoginPerson[]): Promise<void> {
  const acc = his.trim();
  if (!acc || !password) throw new Error("請輸入 HIS 帳號與密碼");
  const db = await getDb();

  if (acc === "super") {
    const rows = await db.select<{ pw_hash: string }[]>("SELECT pw_hash FROM scheduler_users WHERE code = 'super'");
    if (rows[0] && rows[0].pw_hash === await sha256(password)) {
      Object.assign(state, { loggedIn: true, personId: null, his: "super", name: "系統管理員", role: "super" as Role });
      return;
    }
    throw new Error("帳號或密碼錯誤");
  }

  const docs = await db.select<{ his_password: string | null }[]>(
    "SELECT his_password FROM physicians WHERE his_account = ?", [acc],
  );
  if (!docs.some(d => d.his_password && d.his_password === password)) throw new Error("帳號或密碼錯誤");
  const p = people.find(x => x.his === acc && x.active);
  if (!p) throw new Error("此帳號不在排班人員名單，請洽排班者");
  Object.assign(state, { loggedIn: true, personId: p.id, his: acc, name: p.name, role: p.role });
}

export function schedLogout() {
  Object.assign(state, { loggedIn: false, personId: null, his: "", name: "", role: "employee" as Role });
}

let machineId = "";
/** 本機識別（排班鎖用），首次產生後存 app_settings */
export async function getMachineId(): Promise<string> {
  if (machineId) return machineId;
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key = 'sched_machine_id'");
  machineId = rows[0]?.value || crypto.randomUUID();
  if (!rows[0]) await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('sched_machine_id', ?)", [machineId]);
  return machineId;
}
