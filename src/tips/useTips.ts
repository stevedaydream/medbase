/**
 * 新手提示狀態：開關與已看過的提示。
 * 先存本機（app_settings.tips_state）；設定頁綁定「我的 HIS」後跟著帳號存雲端（GAS tipsGet／tipsSet），
 * 換電腦也一樣。雲端與本機合併：已看過取聯集，開關以雲端為準。
 */
import { reactive } from "vue";
import { getDb, dbWrite } from "@/db";
import { gasUrl } from "@/composables/useSchedSync";
import type { TipId } from "./catalog";

interface TipsDoc { off: boolean; seen: string[] }

const state = reactive({ loaded: false, off: false, seen: [] as string[], myHis: "" });
let loading: Promise<void> | null = null;

const SQL_SET = "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)";

async function gas<T>(body: object): Promise<T | null> {
  const url = await gasUrl();
  if (!url) return null;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json() as T & { ok: boolean; error?: string };
  if (!j.ok) throw new Error(j.error ?? "GAS 錯誤");
  return j;
}

/** 依目前綁定的帳號從雲端合併；回傳是否與雲端不同（需要上傳） */
async function mergeCloud(): Promise<boolean> {
  if (!state.myHis) return false;
  try {
    const r = await gas<{ tips: TipsDoc | null }>({ action: "tipsGet", his: state.myHis });
    if (!r) return false;
    if (!r.tips) return true;
    const seen = [...new Set([...r.tips.seen, ...state.seen])];
    const changed = seen.length !== r.tips.seen.length;
    state.off = r.tips.off;
    state.seen = seen;
    return changed;
  } catch {
    return false; // 離線：先用本機的
  }
}

export function loadTips(): Promise<void> {
  loading ??= (async () => {
    try {
      const db = await getDb();
      const rows = await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM app_settings WHERE key IN ('tips_state', 'my_his')",
      );
      for (const r of rows) {
        if (r.key === "my_his") state.myHis = r.value;
        if (r.key === "tips_state") Object.assign(state, JSON.parse(r.value) as TipsDoc);
      }
    } catch { /* 網頁版或尚未建表 */ }
    state.loaded = true;
    if (await mergeCloud()) void save();
    else void saveLocal();
  })();
  return loading;
}

async function saveLocal() {
  try { await dbWrite(SQL_SET, ["tips_state", JSON.stringify({ off: state.off, seen: state.seen })]); } catch { /* 網頁版 */ }
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** 存本機；有綁定帳號時稍後上傳雲端（合併 1 秒內的連續操作） */
function save(): Promise<void> {
  if (state.myHis) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void gas({ action: "tipsSet", his: state.myHis, tips: { off: state.off, seen: state.seen } }).catch(() => { /* 下次再傳 */ });
    }, 1000);
  }
  return saveLocal();
}

export function useTips() {
  return state;
}

/** 這則提示目前是否該顯示 */
export function tipVisible(id: TipId): boolean {
  return state.loaded && !state.off && !state.seen.includes(id);
}

export function markTipSeen(id: TipId) {
  if (state.seen.includes(id)) return;
  state.seen.push(id);
  void save();
}

export function setTipsEnabled(on: boolean) {
  state.off = !on;
  void save();
}

/** 重新顯示全部提示（並開啟） */
export function resetTips() {
  state.seen = [];
  state.off = false;
  void save();
}

/** 設定頁綁定「我的 HIS」：存本機，並改用這個帳號的雲端紀錄 */
export async function setMyHis(his: string): Promise<void> {
  state.myHis = his.trim();
  try { await dbWrite(SQL_SET, ["my_his", state.myHis]); } catch { /* 網頁版 */ }
  if (await mergeCloud()) await save();
  else await saveLocal();
}
