/**
 * 手機依身分區分功能（ADR-026）：共用規則，並在 node VM 執行 gas/scheduler.gs 確認兩邊一致。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import vm from "vm";
import {
  identityOf, normalizeMatrix, featuresOf, featureOfTable, DEFAULT_ACCESS, FEATURES, FEATURE_KEYS, type MobileAccess,
} from "./mobileAccess";

type Fn = (...a: unknown[]) => unknown;
function loadGas(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync("gas/scheduler.gs", "utf8")
    + "\n;this.api = { MOBILE_FEATURES, MOBILE_DEFAULT_ACCESS, _mobileIdentity, _mobileNormalize, _mobileAccess, _mobileTableRows, _syncRow, _syncColumns, SYNC_TABLES };", ctx);
  return ctx.api as Record<string, unknown>;
}
const g = loadGas();
const fn = (k: string) => g[k] as Fn;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("身分與權限", () => {
  it("職稱對應身分", () => {
    expect(identityOf("主治醫師")).toBe("doctor");
    expect(identityOf("住院醫師")).toBe("doctor");
    expect(identityOf("專科護理師")).toBe("np");
    expect(identityOf("護理師")).toBe("nurse");
    expect(identityOf("")).toBe("other");
    expect(identityOf(null)).toBe("other");
  });
  it("「其他」比照護理師；管理者全部都有", () => {
    const m = normalizeMatrix(null);
    expect(featuresOf("other", false, m)).toEqual(DEFAULT_ACCESS.nurse);
    expect(featuresOf("nurse", true, m)).toEqual(FEATURE_KEYS);
  });
  it("清理權限表：不認得的鍵丟掉、缺的身分用預設", () => {
    const m = normalizeMatrix({ doctor: ["sets", "evil"], nurse: [] });
    expect(m.doctor).toEqual(["sets"]);
    expect(m.nurse).toEqual([]);
    expect(m.np).toEqual(DEFAULT_ACCESS.np);
  });
  it("資料表對應權限單位", () => {
    expect(featureOfTable("items")).toBe("items");
    expect(featureOfTable("physicians")).toBe("contacts");
    expect(featureOfTable("unknown")).toBeNull();
  });
});

describe("GAS 與共用規則一致", () => {
  it("權限單位、資料表與預設值相同", () => {
    expect(plain(g.MOBILE_FEATURES)).toEqual(Object.fromEntries(FEATURES.map(f => [f.key, [...f.tables]])));
    expect(plain(g.MOBILE_DEFAULT_ACCESS)).toEqual(DEFAULT_ACCESS);
  });
  it("身分、清理與權限計算相同", () => {
    for (const t of ["主治醫師", "專科護理師", "護理師", "藥師", ""]) expect(fn("_mobileIdentity")(t)).toBe(identityOf(t));
    const raw = { doctor: ["sets", "x"], np: "bad" };
    expect(plain(fn("_mobileNormalize")(raw))).toEqual(normalizeMatrix(raw));
    const m = normalizeMatrix({ nurse: ["memos"] });
    const a = fn("_mobileAccess")({ title: "藥師", mobile_admin: "" }, m) as MobileAccess;
    expect(plain(a)).toEqual({ identity: "other", admin: false, features: ["memos"] });
    expect((fn("_mobileAccess")({ title: "護理師", mobile_admin: "1" }, m) as MobileAccess).admin).toBe(true);
  });
});

describe("GAS 手機讀資料表", () => {
  const rows = [{ name: "甲", his_account: "a", his_password: "p", phs_password: "q", mobile_admin: "1" }];
  const access = (features: string[]) => ({ identity: "nurse", admin: false, features });
  it("沒有權限回傳 null", () => {
    expect(fn("_mobileTableRows")(access(["memos"]), "items", [])).toBeNull();
    expect(fn("_mobileTableRows")(access(["contacts"]), "unknownTable", [])).toBeNull();
  });
  it("通訊錄：一律去掉管理者欄；沒有密碼權限時去掉密碼", () => {
    const noSecret = fn("_mobileTableRows")(access(["contacts"]), "physicians", rows) as Record<string, string>[];
    expect(Object.keys(noSecret[0]).sort()).toEqual(["his_account", "name"]);
    const withSecret = fn("_mobileTableRows")(access(["contacts", "contactSecrets"]), "physicians", rows) as Record<string, string>[];
    expect(withSecret[0].his_password).toBe("p");
    expect(withSecret[0].mobile_admin).toBeUndefined();
  });
});

describe("GAS 同步表新增欄位的相容性", () => {
  const cfg = () => (g.SYNC_TABLES as Record<string, { fields: string[]; headers?: string[] }>).physicians;
  it("舊版上傳沒有新欄位時保留雲端原值；新版帶空白則覆蓋", () => {
    const prev = { name: "甲", mobile_admin: "1" };
    expect((fn("_syncRow")(cfg(), { name: "甲", ext: "1" }, "t", prev) as Record<string, string>).mobile_admin).toBe("1");
    expect((fn("_syncRow")(cfg(), { name: "甲", mobile_admin: "" }, "t", prev) as Record<string, string>).mobile_admin).toBe("");
    expect((fn("_syncRow")(cfg(), { name: "甲" }, "t") as Record<string, string>).mobile_admin).toBe("");
  });
  it("舊工作表（少一欄）依標題對應，updated_at 不會讀錯", () => {
    const oldHead = ["姓名", "科別", "職稱", "分機", "HIS帳號", "HIS密碼", "PHS帳號", "PHS密碼", "備註", "updated_at", ""];
    const pos = fn("_syncColumns")(cfg(), oldHead) as { fields: number[]; updated: number };
    expect(pos.updated).toBe(9);
    expect(pos.fields[cfg().fields.indexOf("mobile_admin")]).toBe(-1);
    expect(pos.fields[cfg().fields.indexOf("notes")]).toBe(8);
    const newHead = [...cfg().headers!, "updated_at"];
    expect(plain(fn("_syncColumns")(cfg(), newHead))).toEqual({ fields: cfg().fields.map((_, i) => i), updated: cfg().fields.length });
  });
});
