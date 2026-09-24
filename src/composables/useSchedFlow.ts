/**
 * 月份流程（schedular.md §7、§9）：排班鎖、發布、退回、發布後修改、換班、欠班。
 */
import {
  useSchedStore, saveMonth, saveLock, saveGlobal, appendLog, actorName, personById, recompute, startMonth,
} from "@/composables/useSchedStore";
import { useSchedSession, getMachineId } from "@/composables/useSchedSession";
import { syncSched, pushScheduleSheet, gasUrl } from "@/composables/useSchedSync";
import { computeQuotas } from "@/utils/sched/engine/quota";
import { cellFnOf } from "@/utils/sched/engine/prefill";
import { settleDebts, targetsWithSwaps } from "@/utils/sched/engine/swaps";
import { newId, type LockInfo, type MonthDoc } from "@/utils/sched/types";
import { personStats, dayStats } from "@/utils/sched/engine/validate";
import { buildAppWorkbook, buildPositionalWorkbook, type ExportCtx } from "@/utils/sched/excelExport";
import * as XLSX from "xlsx";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { nextYm, daysIn } from "@/utils/sched/calendar";

const LOCK_STALE_HOURS = 12;

export class LockedError extends Error {
  constructor(public holder: LockInfo) {
    super(`${holder.name} 正在排班（${new Date(holder.at).toLocaleString()}）`);
  }
}

// ── 排班鎖 ────────────────────────────────────────────────────────────
export async function myLock(ym: string): Promise<boolean> {
  const l = useSchedStore().locks[ym];
  return !!l && l.machine === await getMachineId();
}

/** 取得排班鎖；別台電腦持有且未逾時時丟 LockedError，force 可強制接手 */
export async function acquireLock(ym: string, force = false): Promise<void> {
  const store = useSchedStore();
  const session = useSchedSession();
  await syncSched();
  const machine = await getMachineId();
  const cur = store.locks[ym];
  const stale = cur && Date.now() - new Date(cur.at).getTime() > LOCK_STALE_HOURS * 3600_000;
  if (cur && cur.machine !== machine && !stale && !force) throw new LockedError(cur);
  await saveLock(ym, { his: session.his, name: session.name || actorName(), machine, at: new Date().toISOString() });
  if (cur && cur.machine !== machine) await appendLog(ym, "接手排班鎖", `由 ${cur.name} 手上${force ? "強制" : "（逾時）"}接手`, actorName());
  const rep = await syncSched();
  // 同時搶鎖：同步後雲端的鎖若不是本機，代表輸了
  if (rep && store.locks[ym]?.machine !== machine) throw new LockedError(store.locks[ym]!);
}

export async function releaseLock(ym: string): Promise<void> {
  if (await myLock(ym)) await saveLock(ym, null);
}

// ── 開始排班 ─────────────────────────────────────────────────────────
export async function beginScheduling(ym: string, force = false): Promise<void> {
  await acquireLock(ym);
  await startMonth(ym, force);
  await syncSched();
}

// ── 發布 ─────────────────────────────────────────────────────────────
export function monthTargets(m: MonthDoc): Record<string, Record<string, number>> {
  const store = useSchedStore();
  const base = m.status === "published" && m.frozenQuotas
    ? m.frozenQuotas
    : computeQuotas({ month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems, cell: cellFnOf(m, store.prebooks[m.ym]) }).quotas;
  return targetsWithSwaps(base, m, store.quotaItems.filter(i => i.enabled));
}

async function publishSheet(m: MonthDoc): Promise<boolean> {
  const rows = m.roster.filter(r => r.flags.active).map(r => ({
    name: personById(r.personId)?.name ?? "?",
    days: Array.from({ length: daysIn(m.ym) }, (_, i) => m.schedule[r.personId]?.[i] ?? ""),
  }));
  try {
    return await pushScheduleSheet(m.ym, rows);
  } catch (e) {
    await appendLog(m.ym, "發布到手機失敗", (e as Error).message);
    return false;
  }
}

export async function publishMonth(ym: string, unresolved: number): Promise<{ sheet: boolean }> {
  const store = useSchedStore();
  const m = store.months[ym];
  if (!m || m.status !== "scheduling") throw new Error("此月份不在排班中");
  if (!await myLock(ym)) throw new Error("排班鎖不在本機，請先取得排班鎖");
  const q = computeQuotas({ month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems, cell: cellFnOf(m, store.prebooks[ym]) });
  m.frozenQuotas = q.quotas;
  for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
  m.status = "published";
  m.publishedAt = new Date().toISOString();
  await saveMonth(m);
  // 換班結算欠班
  const before = store.debts.length;
  store.debts = settleDebts(store.debts, m, store.quotaItems.filter(i => i.enabled));
  await saveGlobal("debts");
  await releaseLock(ym);
  const sheet = await publishSheet(m);
  await appendLog(ym, "發布", `${unresolved ? `仍有 ${unresolved} 項檢核警告（已確認）；` : ""}配額與 X 定案${store.debts.length > before ? `；新增欠班 ${store.debts.length - before} 筆` : ""}${sheet ? "；已發布到手機" : "；未設定 GAS，手機看不到"}`, actorName());
  if (store.months[nextYm(ym)]) await recompute(nextYm(ym), `${ym} 發布，X 定案`);
  await syncSched();
  return { sheet };
}

export function revertDeadline(m: MonthDoc): number | null {
  if (m.status !== "published" || m.imported || !m.publishedAt) return null;
  return new Date(m.publishedAt).getTime() + useSchedStore().rules.revertHours * 3600_000;
}

export async function revertMonth(ym: string): Promise<void> {
  const store = useSchedStore();
  const m = store.months[ym];
  const dl = m ? revertDeadline(m) : null;
  if (!dl || Date.now() > dl) throw new Error("已超過可退回期限，請改用「修改已發布班表」");
  const nxt = store.months[nextYm(ym)];
  if (nxt && nxt.status !== "open") throw new Error(`${nextYm(ym)} 已開始排班，無法退回`);
  await acquireLock(ym);
  m.status = "scheduling";
  m.frozenQuotas = null;
  await saveMonth(m);
  await appendLog(ym, "退回排班中", "發布後於期限內退回", actorName());
  await syncSched();
}

// ── 發布後修改 ───────────────────────────────────────────────────────
export async function beginPostEdit(ym: string, force = false): Promise<void> {
  await acquireLock(ym, force);
}

export async function endPostEdit(ym: string): Promise<void> {
  await releaseLock(ym);
  await syncSched();
}

/** 發布後修改存檔後：重新發布到手機 */
export async function republish(ym: string): Promise<boolean> {
  const m = useSchedStore().months[ym];
  if (!m || m.status !== "published") return false;
  const ok = await publishSheet(m);
  await appendLog(ym, "自動重新發布", ok ? "已更新手機班表" : "未設定 GAS，手機看不到");
  return ok;
}

// ── 換班 ─────────────────────────────────────────────────────────────
export async function createSwap(ym: string, day: number, a: string, b: string, note: string): Promise<void> {
  const m = useSchedStore().months[ym];
  if (!m) return;
  const sa = m.schedule[a] ?? (m.schedule[a] = Array(daysIn(ym)).fill(""));
  const sb = m.schedule[b] ?? (m.schedule[b] = Array(daysIn(ym)).fill(""));
  const aCode = sa[day - 1] ?? "", bCode = sb[day - 1] ?? "";
  sa[day - 1] = bCode;
  sb[day - 1] = aCode;
  (m.swaps ??= []).push({ id: newId(), day, a, b, aCode, bCode, at: new Date().toISOString(), by: actorName(), note });
  await saveMonth(m);
  const nm = (id: string) => personById(id)?.name ?? "?";
  await appendLog(ym, "換班", `${nm(a)} ${Number(ym.slice(4))}/${day} ${aCode || "空白"} ↔ ${nm(b)} ${bCode || "空白"}${note ? `（${note}）` : ""}`, actorName());
  if (m.status === "published") await republish(ym);
}

export async function deleteSwap(ym: string, id: string): Promise<void> {
  const m = useSchedStore().months[ym];
  const s = m?.swaps?.find(x => x.id === id);
  if (!m || !s) return;
  // 格子仍是換班後的值才換回
  if ((m.schedule[s.a]?.[s.day - 1] ?? "") === s.bCode && (m.schedule[s.b]?.[s.day - 1] ?? "") === s.aCode) {
    m.schedule[s.a][s.day - 1] = s.aCode;
    m.schedule[s.b][s.day - 1] = s.bCode;
  }
  m.swaps = m.swaps!.filter(x => x.id !== id);
  await saveMonth(m);
  const nm = (pid: string) => personById(pid)?.name ?? "?";
  await appendLog(ym, "刪除換班", `${nm(s.a)} ↔ ${nm(s.b)} ${Number(ym.slice(4))}/${s.day}`, actorName());
  if (m.status === "published") await republish(ym);
}

export async function settleDebt(id: string, note: string): Promise<void> {
  const store = useSchedStore();
  const d = store.debts.find(x => x.id === id);
  if (!d) return;
  d.settledAt = new Date().toISOString();
  d.note = note || "手動平帳";
  await saveGlobal("debts");
  await appendLog("global", "欠班平帳", `${personById(d.from)?.name} 欠 ${personById(d.to)?.name} ${d.item}×${d.qty}：${d.note}`, actorName());
}

// ── 匯出 ─────────────────────────────────────────────────────────────
export type ExportKind = "app" | "positional";

export async function exportMonth(ym: string, kind: ExportKind): Promise<string | null> {
  const store = useSchedStore();
  const m = store.months[ym];
  if (!m) return null;
  const items = store.quotaItems.filter(i => i.enabled);
  const pb = store.prebooks[ym];
  const q = computeQuotas({ month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems, cell: cellFnOf(m, pb) });
  const cell = (id: string, d: number) => m.schedule[id]?.[d - 1] ?? "";
  const g = { month: m, prebook: pb, holidays: store.holidays, shifts: store.shifts, items, rules: store.rules, cell, offSlots: q.offSlots, name: (id: string) => personById(id)?.name ?? "?" };
  const counts: Record<string, Record<string, number>> = {}, hours: Record<string, number> = {};
  for (const r of m.roster) {
    const st = personStats(g, r.personId);
    counts[r.personId] = st.counts;
    hours[r.personId] = st.hours;
  }
  const ctx: ExportCtx = {
    month: m, prebook: pb, holidays: store.holidays, items, people: store.people,
    quotas: monthTargets(m), counts, hours, offSlots: q.offSlots,
    offCount: Array.from({ length: daysIn(ym) }, (_, i) => dayStats(g, i + 1).off),
    duty84: store.duty84, cny: store.cny,
  };
  const wb = kind === "app" ? buildAppWorkbook(ctx) : buildPositionalWorkbook(ctx);
  const path = await saveDialog({
    title: kind === "app" ? "匯出班表" : "匯出 Excel 完整格式（過渡期）",
    defaultPath: kind === "app" ? `班表_${ym}.xlsx` : `9A值班表_${ym}_貼回用.xlsx`,
    filters: [{ name: "Excel 活頁簿", extensions: ["xlsx"] }],
  });
  if (!path) return null;
  await writeFile(path, XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array);
  await appendLog(ym, "匯出", `${kind === "app" ? "班表 XLSX" : "Excel 完整格式"}：${path.split(/[\\/]/).pop()}`, actorName());
  return path;
}

// ── 通知 ─────────────────────────────────────────────────────────────
export async function markNoticesRead(personId: string): Promise<void> {
  const store = useSchedStore();
  let changed = false;
  for (const n of store.notices) if (n.personId === personId && !n.read) { n.read = true; changed = true; }
  if (changed) await saveGlobal("notices");
}

export async function isCloudConfigured(): Promise<boolean> {
  return !!(await gasUrl());
}
