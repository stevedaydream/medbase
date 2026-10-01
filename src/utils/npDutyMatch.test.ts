import { describe, expect, it } from "vitest";
import { applyDutyCorrection, dutyCodeKey, reconcileDutyRows, type DutyPerson } from "./npDutyMatch";
import type { NpDutyImportRow } from "./npDutyXlsx";
import { rosterMatchesFromOcr } from "./npDutyOcr";

const row = (ward: NpDutyImportRow["ward"], staffCode: string): NpDutyImportRow => ({
  dutyDate: "2026-10-01", ward, npName: "", staffCode, extension: "", shift: "值班",
  notes: "", sourceSheet: "Word", resolution: "unresolved",
});

describe("duty personnel reconciliation", () => {
  it("uses the latest unambiguous month and checks the current Word roster", () => {
    const history: DutyPerson[] = [
      { duty_date: "2026-08-01", ward: "9A", np_name: "舊姓名", staff_code: "x", extension: "62001" },
      { duty_date: "2026-09-01", ward: "8A", np_name: "王小明", staff_code: "x", extension: "62002" },
    ];
    expect(reconcileDutyRows([row("9A", "x")], history, {}, new Set(["王小明"]))[0])
      .toMatchObject({ npName: "王小明", extension: "62002", resolution: "history" });
    expect(reconcileDutyRows([row("9A", "x")], history, {}, new Set(["其他人"]))[0].npName).toBe("");
  });

  it("does not guess when one code maps to multiple people in the latest month", () => {
    const history: DutyPerson[] = [
      { duty_date: "2026-09-01", ward: "9A", np_name: "王小明", staff_code: "x", extension: null },
      { duty_date: "2026-09-02", ward: "8A", np_name: "李小美", staff_code: "x", extension: null },
    ];
    expect(reconcileDutyRows([row("9A", "x")], history, {})[0].resolution).toBe("unresolved");
  });

  it("keeps VS specialty codes separate and applies a manual correction to every date", () => {
    const rows = [row("GS", "1"), { ...row("GS", "1"), dutyDate: "2026-10-02" }, row("NS", "1")];
    const corrected = applyDutyCorrection(rows, dutyCodeKey(rows[0]), { name: "陳小華", extension: "61111" });
    expect(corrected.map(item => item.npName)).toEqual(["陳小華", "陳小華", ""]);
  });

  it("uses a photographed roster only when its code and unit are explicit", () => {
    const matches = rosterMatchesFromOcr("ⓧ○王小明62001\n1.陳小華61111 GS\n2.李小美62222", [row("9A", "x"), row("GS", "1"), row("NS", "2")]);
    expect(matches["NP|x"]?.name).toBe("王小明");
    expect(matches["VS:GS|1"]?.name).toBe("陳小華");
    expect(matches["VS:NS|2"]).toBeUndefined();
  });
});
