/**
 * 存檔點：整月排班層＋預班層的快照（snap:YYYYMM-NN，每月固定 SNAP_SLOTS 格）。
 * 還原時算出與目前的差異，交給編輯器當成一步操作套用（可復原、會通知、寫紀錄）。
 */
import { daysIn } from "./calendar";
import { SNAP_SLOTS, clone, type MonthDoc, type PrebookDoc, type PrebookCell, type SnapshotDoc } from "./types";

/** 某月的存檔點，新到舊 */
export function snapsOf(snaps: Record<string, SnapshotDoc | null>, ym: string): SnapshotDoc[] {
  return Object.values(snaps).filter((s): s is SnapshotDoc => !!s && s.ym === ym).sort((a, b) => b.at.localeCompare(a.at));
}

/** 新存檔點放哪一格：空格優先；滿了覆蓋最舊的自動存檔點，沒有自動的才覆蓋最舊的 */
export function pickSnapSlot(snaps: Record<string, SnapshotDoc | null>, ym: string): number {
  const used = snapsOf(snaps, ym);
  const taken = new Set(used.map(s => s.slot));
  for (let i = 1; i <= SNAP_SLOTS; i++) if (!taken.has(i)) return i;
  const oldest = [...used].reverse();
  return (oldest.find(s => s.auto) ?? oldest[0]).slot;
}

export function makeSnapshot(
  m: MonthDoc, pb: PrebookDoc | undefined, slot: number, name: string, by: string, at: string, auto?: SnapshotDoc["auto"],
): SnapshotDoc {
  return {
    ym: m.ym, slot, name, at, by, ...(auto ? { auto } : {}), status: m.status,
    schedule: clone(m.schedule), origin: clone(m.origin), prebook: clone(pb?.cells ?? {}),
  };
}

export interface SnapCellDiff<T> { personId: string; day: number; before: T | undefined; after: T | undefined }

const sameCell = (a: PrebookCell | undefined, b: PrebookCell | undefined) =>
  (a?.v ?? null) === (b?.v ?? null) && (a?.src ?? "") === (b?.src ?? "") && !!a?.auto === !!b?.auto;

/**
 * 還原差異：開放預班只還原預班層；排班中還原排班層與預班層。已發布不提供還原。
 * 只比對目前名單中的人。
 */
export function snapshotDiff(s: SnapshotDoc, m: MonthDoc, pb: PrebookDoc | undefined): { sched: SnapCellDiff<string>[]; pre: SnapCellDiff<PrebookCell>[] } {
  const sched: SnapCellDiff<string>[] = [];
  const pre: SnapCellDiff<PrebookCell>[] = [];
  if (m.status === "published") return { sched, pre };
  const ids = m.roster.map(r => r.personId);
  const nd = daysIn(m.ym);
  for (const id of ids) {
    for (let d = 1; d <= nd; d++) {
      const k = `${id}|${d}`;
      const cur = pb?.cells[k], want = s.prebook[k];
      if (!sameCell(cur, want)) pre.push({ personId: id, day: d, before: cur, after: want });
      if (m.status !== "scheduling") continue;
      const cv = m.schedule[id]?.[d - 1] ?? "", sv = s.schedule[id]?.[d - 1] ?? "";
      if (cv !== sv) sched.push({ personId: id, day: d, before: cv, after: sv });
    }
  }
  return { sched, pre };
}
