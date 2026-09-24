/**
 * 排班 v3 雲端同步（ADR-014）：本機 sched_docs ↔ GAS SchDocs。
 * 本機修改後約 3 秒自動同步；排班頁開著時每分鐘輪詢一次。未設定 GAS 網址時為單機模式。
 */
import { reactive, readonly } from "vue";
import { useCloudSettings } from "@/stores/cloudSettings";
import { localDocs, applyCloudDoc, markSynced, onSchedDirty } from "@/composables/useSchedStore";
import { syncOnce, type SyncRemote, type SyncReport, type PutResult } from "@/utils/sched/sync";

export type SyncStatus = "offline" | "idle" | "syncing" | "ok" | "error";

const state = reactive({
  status: "idle" as SyncStatus,
  lastAt: "",
  message: "",
  conflicts: [] as string[],
});

async function gasPost<T>(gasUrl: string, body: object): Promise<T> {
  const res = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json() as T & { ok: boolean; error?: string };
  if (!j.ok) throw new Error(j.error ?? "GAS 錯誤");
  return j;
}

export async function gasUrl(): Promise<string> {
  const cloud = useCloudSettings();
  await cloud.load();
  return cloud.gasUrl;
}

function remote(url: string): SyncRemote {
  return {
    list: async () => (await gasPost<{ docs: { key: string; version: string }[] }>(url, { action: "schList" })).docs,
    get: async keys => (await gasPost<{ docs: { key: string; version: string; json: string }[] }>(url, { action: "schGet", keys })).docs,
    put: async items => (await gasPost<{ results: PutResult[] }>(url, { action: "schPut", items })).results,
  };
}

let running: Promise<SyncReport | null> | null = null;
let rerun = false;

/** 立即同步一次；同步進行中再呼叫會在結束後補跑一次 */
export function syncSched(): Promise<SyncReport | null> {
  if (running) { rerun = true; return running; }
  running = (async () => {
    const url = await gasUrl();
    if (!url) { state.status = "offline"; state.message = "未設定 GAS 網址，資料只存在本機"; return null; }
    state.status = "syncing";
    try {
      const rep = await syncOnce({ list: localDocs, apply: applyCloudDoc, synced: markSynced }, remote(url));
      state.status = "ok";
      state.lastAt = new Date().toISOString();
      state.conflicts = rep.conflicts;
      state.message = rep.conflicts.length ? `雲端已被其他電腦更新，已改用雲端版本：${rep.conflicts.join("、")}` : "";
      return rep;
    } catch (e) {
      state.status = "error";
      state.message = `同步失敗：${(e as Error).message}`;
      return null;
    }
  })().finally(() => {
    running = null;
    if (rerun) { rerun = false; void syncSched(); }
  });
  return running;
}

let debounce: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let offDirty: (() => void) | null = null;
let users = 0;

/** 排班頁掛載時啟用自動同步（多個元件共用，計數到 0 才停） */
export function startAutoSync(): () => void {
  users++;
  if (users === 1) {
    offDirty = onSchedDirty(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void syncSched(), 3000);
    });
    poll = setInterval(() => void syncSched(), 60_000);
    void syncSched();
  }
  return () => {
    users--;
    if (users > 0) return;
    offDirty?.();
    if (poll) clearInterval(poll);
    if (debounce) clearTimeout(debounce);
    poll = null; debounce = null; offDirty = null;
  };
}

/** 發布到手機：寫成 Schedule_YYYYMM（沿用 saveSchedule 格式：姓名＋1–31 日） */
export async function pushScheduleSheet(ym: string, rows: { name: string; days: string[] }[]): Promise<boolean> {
  const url = await gasUrl();
  if (!url) return false;
  const cloud = useCloudSettings();
  await gasPost(url, {
    action: "saveSchedule",
    sheetName: `Schedule_${ym}`,
    data: rows.map(r => ({ name: r.name, days: Array.from({ length: 31 }, (_, i) => r.days[i] ?? "") })),
    ...(cloud.scheduleSpreadsheetId ? { spreadsheetId: cloud.scheduleSpreadsheetId } : {}),
  });
  return true;
}

export function useSchedSync() {
  return readonly(state);
}
