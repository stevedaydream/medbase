import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  BACKUP_GROUPS, EXCLUDED_TABLES, MIGRATION_TABLES, LEGACY_TABLES, ALL_GROUP_TABLES,
  snapshotName, parseSnapshotName, snapshotsToPrune, hasDailyToday, parseGroupFile, previewGroupFile, xlsxCell,
  KEEP_DAILY, KEEP_PRE, type SnapshotInfo,
} from "./backupRegistry";

describe("備份清單涵蓋所有資料表", () => {
  const created = [...new Set([...readFileSync("src/db/index.ts", "utf8").matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_0-9]+)/g)].map(m => m[1]))];
  it("每張 CREATE TABLE 都要歸到群組或列為不備份（新增資料表時請更新 backupRegistry.ts）", () => {
    const known = new Set([...ALL_GROUP_TABLES, ...EXCLUDED_TABLES, ...MIGRATION_TABLES]);
    expect(created.filter(t => !known.has(t))).toEqual([]);
  });
  it("群組清單沒有不存在或重複的表；舊表不會被建立", () => {
    expect(ALL_GROUP_TABLES.filter(t => !created.includes(t))).toEqual([]);
    expect(new Set(ALL_GROUP_TABLES).size).toBe(ALL_GROUP_TABLES.length);
    expect(LEGACY_TABLES.filter(t => created.includes(t))).toEqual([]);
    expect(new Set(BACKUP_GROUPS.map(g => g.key)).size).toBe(BACKUP_GROUPS.length);
  });
});

describe("快照命名與保留", () => {
  it("檔名往返", () => {
    const d = new Date(2026, 9, 3, 7, 5, 9);
    expect(snapshotName("daily", d)).toBe("medbase_daily_20261003-070509.db");
    expect(parseSnapshotName("medbase_keep_20261003-070509_legacy.db")).toMatchObject({ kind: "keep", note: "legacy" });
    expect(parseSnapshotName("medbase_daily_20261003-070509.db")!.at.getTime()).toBe(d.getTime());
    expect(parseSnapshotName("other.db")).toBeNull();
  });
  it("每日留 14、操作前合計留 10、永久保留不刪", () => {
    const mk = (kind: SnapshotInfo["kind"], i: number): SnapshotInfo => ({ name: `${kind}${i}`, kind, at: new Date(2026, 0, i + 1), note: "" });
    const list = [
      ...Array.from({ length: 20 }, (_, i) => mk("daily", i)),
      ...Array.from({ length: 8 }, (_, i) => mk("pre-import", i)),
      ...Array.from({ length: 6 }, (_, i) => mk("pre-restore", i + 10)),
      mk("keep", 0),
    ];
    const gone = snapshotsToPrune(list);
    expect(gone.filter(x => x.kind === "daily").length).toBe(20 - KEEP_DAILY);
    expect(gone.filter(x => x.kind.startsWith("pre-")).length).toBe(14 - KEEP_PRE);
    expect(gone.some(x => x.kind === "keep")).toBe(false);
    // 刪的是最舊的
    expect(gone.filter(x => x.kind === "daily").map(x => x.name)).toEqual(["daily5", "daily4", "daily3", "daily2", "daily1", "daily0"]);
    expect(hasDailyToday(list, new Date(2026, 0, 20, 23))).toBe(true);
    expect(hasDailyToday(list, new Date(2026, 0, 21))).toBe(false);
  });
});

describe("群組備份檔", () => {
  it("格式檢查與預覽", () => {
    expect(() => parseGroupFile("x")).toThrow("JSON");
    expect(() => parseGroupFile(JSON.stringify({ format: "other", tables: {} }))).toThrow("不是 MedBase");
    expect(() => parseGroupFile(JSON.stringify({ format: "medbase-groups", version: 99, tables: {} }))).toThrow("較新版本");
    const f = parseGroupFile(JSON.stringify({ format: "medbase-groups", version: 1, tables: { sets: [{}, {}], set_items: [], unknown_t: [{}] } }));
    const p = previewGroupFile(f);
    expect(p.map(x => x.group.key)).toEqual(["sets"]);
    expect(p[0].tables).toEqual([{ table: "sets", rows: 2 }, { table: "set_items", rows: 0 }]);
  });
  it("Excel 檢視用：超長欄位標示", () => {
    expect(xlsxCell("短")).toBe("短");
    expect(String(xlsxCell("a".repeat(40000)))).toContain("內容過長");
  });
});
