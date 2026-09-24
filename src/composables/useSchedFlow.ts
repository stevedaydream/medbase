/**
 * 月份流程（schedular.md §7、§9）：排班鎖、發布、退回、發布後修改、換班、欠班。
 */
import {
  useSchedStore, saveLock, saveGlobal, appendLog, actorName, personById, startMonth, snapshot, applyPatch,
} from "@/composables/useSchedStore";
import {
  opPublish, opRevert, opCreateSwap, opDeleteSwap, opSettleDebt, revertDeadline as sharedDeadline,
  opAddPrefillSwap, opRemovePrefillSwap,
  lockDecision, monthTargets as sharedTargets, publishRows,
} from "@/shared/sched/ops";
import { useSchedSession, getMachineId } from "@/composables/useSchedSession";
import { syncSched, pushScheduleSheet, gasUrl } from "@/composables/useSchedSync";
import { computeQuotas } from "@/shared/sched/engine/quota";
import { cellFnOf } from "@/shared/sched/engine/prefill";
import type { LockInfo, MonthDoc } from "@/shared/sched/types";
import { personStats, dayStats } from "@/shared/sched/engine/validate";
import { buildAppWorkbook, buildPositionalWorkbook, type ExportCtx } from "@/utils/sched/excelExport";
import * as XLSX from "xlsx";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { daysIn } from "@/shared/sched/calendar";

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

/** 取得排班鎖；別台裝置持有且未逾時時丟 LockedError，force 可強制接手 */
export async function acquireLock(ym: string, force = false): Promise<void> {
  const store = useSchedStore();
  const session = useSchedSession();
  await syncSched();
  const machine = await getMachineId();
  const cur = store.locks[ym];
  const d = lockDecision(cur ?? null, machine, Date.now(), force);
  if (!d.ok) throw new LockedError(cur!);
  await saveLock(ym, { his: session.his, name: session.name || actorName(), machine, at: new Date().toISOString() });
  if (d.takeover) await appendLog(ym, "接手排班鎖", `由 ${cur!.name} 手上${d.stale ? "（逾時）" : "強制"}接手`, actorName());
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
  return sharedTargets(snapshot(), m);
}

async function publishSheet(m: MonthDoc): Promise<boolean> {
  try {
    return await pushScheduleSheet(m.ym, publishRows(m, useSchedStore().people));
  } catch (e) {
    await appendLog(m.ym, "發布到手機失敗", (e as Error).message);
    return false;
  }
}

export async function publishMonth(ym: string, unresolved: number): Promise<{ sheet: boolean }> {
  if (!await myLock(ym)) throw new Error("排班鎖不在本機，請先取得排班鎖");
  await applyPatch(opPublish(snapshot(), ym, unresolved, actorName(), new Date().toISOString()));
  await releaseLock(ym);
  const sheet = await publishSheet(useSchedStore().months[ym]);
  await appendLog(ym, "發布到手機", sheet ? "已更新手機班表" : "未設定 GAS，手機看不到");
  await syncSched();
  return { sheet };
}

export function revertDeadline(m: MonthDoc): number | null {
  return sharedDeadline(m, useSchedStore().rules);
}

export async function revertMonth(ym: string): Promise<void> {
  const p = opRevert(snapshot(), ym, actorName(), new Date().toISOString());
  await acquireLock(ym);
  await applyPatch(p);
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
  if (!useSchedStore().months[ym]) return;
  await applyPatch(opCreateSwap(snapshot(), ym, day, a, b, note, actorName(), new Date().toISOString()));
  if (useSchedStore().months[ym].status === "published") await republish(ym);
}

export async function deleteSwap(ym: string, id: string): Promise<void> {
  await applyPatch(opDeleteSwap(snapshot(), ym, id, actorName()));
  if (useSchedStore().months[ym]?.status === "published") await republish(ym);
}

// ── 預填換人（開放預班）───────────────────────────────────────────
export async function addPrefillSwap(ym: string, from: string, to: string, cells: { day: number; code: string }[], note: string): Promise<void> {
  await applyPatch(opAddPrefillSwap(snapshot(), ym, from, to, cells, note, actorName(), new Date().toISOString()));
}

export async function removePrefillSwap(ym: string, group: string): Promise<void> {
  await applyPatch(opRemovePrefillSwap(snapshot(), ym, group, actorName(), new Date().toISOString()));
}

export async function settleDebt(id: string, note: string): Promise<void> {
  await applyPatch(opSettleDebt(snapshot(), id, note, actorName(), new Date().toISOString()));
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
