import { describe, it, expect } from "vitest";
import { pickSnapSlot, makeSnapshot, snapshotDiff, snapsOf } from "./snapshots";
import { SNAP_SLOTS, emptyMonth, emptyFlags, snapKey, type MonthDoc, type PrebookDoc, type SnapshotDoc } from "./types";

const cell = (v: string, src: "emp" | "sys" = "emp") => ({ v, src, by: "x", at: "t" });
function month(status: MonthDoc["status"]): MonthDoc {
  const m = emptyMonth("202611");
  m.status = status;
  m.roster = [{ personId: "a", flags: emptyFlags() }, { personId: "b", flags: emptyFlags() }];
  m.schedule = { a: Array(30).fill(""), b: Array(30).fill("") };
  m.origin = { a: Array(30).fill(""), b: Array(30).fill("") };
  return m;
}
const snapAt = (slot: number, at: string, auto?: SnapshotDoc["auto"]): SnapshotDoc =>
  ({ ...makeSnapshot(month("scheduling"), undefined, slot, `s${slot}`, "x", at, auto) });

describe("存檔點", () => {
  it("空格優先；滿了覆蓋最舊的自動存檔點，沒有自動的覆蓋最舊的", () => {
    const snaps: Record<string, SnapshotDoc | null> = { [snapKey("202611", 1)]: snapAt(1, "2026-10-01") };
    expect(pickSnapSlot(snaps, "202611")).toBe(2);
    for (let i = 1; i <= SNAP_SLOTS; i++) snaps[snapKey("202611", i)] = snapAt(i, `2026-10-${String(i).padStart(2, "0")}T00`, i === 7 || i === 9 ? "start" : undefined);
    expect(pickSnapSlot(snaps, "202611")).toBe(7);
    for (let i = 1; i <= SNAP_SLOTS; i++) snaps[snapKey("202611", i)] = snapAt(i, `2026-10-${String(i).padStart(2, "0")}T00`);
    expect(pickSnapSlot(snaps, "202611")).toBe(1);
    snaps[snapKey("202611", 3)] = null;
    expect(pickSnapSlot(snaps, "202611")).toBe(3);
  });

  it("列出某月存檔點：新到舊、略過空格與其他月份", () => {
    const other = { ...snapAt(2, "2026-10-09"), ym: "202612" };
    const list = snapsOf({ x: snapAt(1, "2026-10-01"), y: snapAt(4, "2026-10-05"), z: null, w: other }, "202611");
    expect(list.map(s => s.slot)).toEqual([4, 1]);
  });

  it("排班中還原兩層；開放預班只還原預班；已發布不還原", () => {
    const m = month("scheduling");
    const pb: PrebookDoc = { ym: "202611", cells: { "a|1": cell("OFF"), "b|2": cell("N", "sys") } };
    m.schedule.a[0] = "OFF";
    const snap = makeSnapshot(m, pb, 1, "x", "x", "t");
    m.schedule.a[0] = "D";
    m.schedule.b[4] = "N";
    const pb2: PrebookDoc = { ym: "202611", cells: { "b|2": cell("N", "sys"), "a|3": cell("勿休") } };
    const d = snapshotDiff(snap, m, pb2);
    expect(d.sched.map(c => `${c.personId}${c.day}:${c.before}->${c.after}`)).toEqual(["a1:D->OFF", "b5:N->"]);
    expect(d.pre.map(c => `${c.personId}${c.day}:${c.before?.v ?? ""}->${c.after?.v ?? ""}`)).toEqual(["a1:->OFF", "a3:勿休->"]);
    expect(snapshotDiff(snap, { ...m, status: "open" }, pb2).sched).toEqual([]);
    expect(snapshotDiff(snap, { ...m, status: "published" }, pb2)).toEqual({ sched: [], pre: [] });
  });

  it("快照與目前狀態脫鉤（之後修改不影響快照）", () => {
    const m = month("scheduling");
    const snap = makeSnapshot(m, { ym: "202611", cells: { "a|1": cell("OFF") } }, 1, "x", "x", "t");
    m.schedule.a[0] = "D";
    expect(snap.schedule.a[0]).toBe("");
  });
});
