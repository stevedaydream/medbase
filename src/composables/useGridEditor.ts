/**
 * 排班格編輯：預班層／排班層寫入、復原重做（100 步，換月清空）、操作紀錄、存檔。
 * 排班層變動後更新本月 X；X 改變時往後重算開放月份的 V 交接。
 */
import { ref, computed, type Ref } from "vue";
import {
  useSchedStore, saveMonth, savePrebook, appendLog, actorName, personById, recompute,
} from "@/composables/useSchedStore";
import { useSchedSession } from "@/composables/useSchedSession";
import { cellKey, type PrebookCell, CONSTRAINT_MARKS } from "@/utils/sched/types";
import { computeQuotas } from "@/utils/sched/engine/quota";
import { cellFnOf } from "@/utils/sched/engine/prefill";
import { nextYm, daysIn } from "@/utils/sched/calendar";

export type Layer = "pre" | "sched";
export interface CellRef { personId: string; day: number }
interface Change { personId: string; day: number; before: string | PrebookCell | undefined; after: string | PrebookCell | undefined }
interface Op { layer: Layer; ym: string; changes: Change[] }

const UNDO_LIMIT = 100;

export function useGridEditor(ym: Ref<string>, layer: Ref<Layer>) {
  const store = useSchedStore();
  const session = useSchedSession();
  const undoStack = ref<Op[]>([]);
  const redoStack = ref<Op[]>([]);
  const lastError = ref("");

  const month = computed(() => store.months[ym.value]);
  const prebook = computed(() => store.prebooks[ym.value]);
  const isStaff = computed(() => session.role !== "employee");

  /** 目前層是否可編輯（第四階段加入排班鎖與發布後修改） */
  const editable = computed(() => {
    const m = month.value;
    if (!m) return false;
    if (layer.value === "pre") return m.status === "open";
    return m.status === "scheduling" && isStaff.value;
  });

  function canEditCell(personId: string, day: number): boolean {
    if (!editable.value) return false;
    if (layer.value === "pre") {
      if (!isStaff.value && personId !== session.personId) return false;
      return prebook.value?.cells[cellKey(personId, day)]?.src !== "sys";
    }
    return true;
  }

  function read(l: Layer, personId: string, day: number): string {
    if (l === "pre") return prebook.value?.cells[cellKey(personId, day)]?.v ?? "";
    return month.value?.schedule[personId]?.[day - 1] ?? "";
  }

  function rawBefore(l: Layer, personId: string, day: number): string | PrebookCell | undefined {
    if (l === "pre") {
      const c = prebook.value?.cells[cellKey(personId, day)];
      return c ? { ...c } : undefined;
    }
    return read("sched", personId, day);
  }

  function write(l: Layer, personId: string, day: number, val: string | PrebookCell | undefined) {
    if (l === "pre") {
      const pb = prebook.value ?? (store.prebooks[ym.value] = { ym: ym.value, cells: {} });
      const k = cellKey(personId, day);
      if (val === undefined) delete pb.cells[k];
      else pb.cells[k] = val as PrebookCell;
    } else {
      const m = month.value!;
      m.schedule[personId] ??= Array(daysIn(m.ym)).fill("");
      m.origin[personId] ??= Array(daysIn(m.ym)).fill("");
      m.schedule[personId][day - 1] = (val as string) ?? "";
      m.origin[personId][day - 1] = "";
    }
  }

  function newPreCell(v: string): PrebookCell {
    return { v: v || null, src: "emp", by: session.his || actorName(), at: new Date().toISOString() };
  }

  /** 設定多格；回傳實際變更的格數 */
  function setCells(targets: CellRef[], value: string, action = "改格"): number {
    lastError.value = "";
    const l = layer.value;
    if (!editable.value) { lastError.value = "此月份目前不可編輯"; return 0; }
    if (l === "sched" && (CONSTRAINT_MARKS as readonly string[]).includes(value)) {
      lastError.value = "勿休／勿值是預班註記，請在預班層登記"; return 0;
    }
    const changes: Change[] = [];
    let skipped = 0;
    for (const t of targets) {
      if (!canEditCell(t.personId, t.day)) { skipped++; continue; }
      if (read(l, t.personId, t.day) === value) continue;
      const before = rawBefore(l, t.personId, t.day);
      const after = l === "pre" ? newPreCell(value) : value;
      write(l, t.personId, t.day, after);
      changes.push({ personId: t.personId, day: t.day, before, after });
    }
    if (skipped) lastError.value = `${skipped} 格不可編輯（系統預填或非本人）已略過`;
    if (!changes.length) return 0;
    push({ layer: l, ym: ym.value, changes });
    commit(l, changes, action);
    return changes.length;
  }

  /** 貼上：以左上角為起點，values[row][col] */
  function paste(anchor: CellRef, rows: string[], values: string[][]) {
    const startRow = rows.indexOf(anchor.personId);
    if (startRow < 0) return 0;
    const nd = daysIn(ym.value);
    const byValue = new Map<string, CellRef[]>();
    values.forEach((line, r) => line.forEach((v, c) => {
      const pid = rows[startRow + r];
      const day = anchor.day + c;
      if (!pid || day > nd) return;
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v)!.push({ personId: pid, day });
    }));
    // 合併為單一復原步驟
    const all: Change[] = [];
    const l = layer.value;
    for (const [v, cells] of byValue) {
      for (const t of cells) {
        if (!canEditCell(t.personId, t.day) || read(l, t.personId, t.day) === v) continue;
        if (l === "sched" && (CONSTRAINT_MARKS as readonly string[]).includes(v)) continue;
        const before = rawBefore(l, t.personId, t.day);
        const after = l === "pre" ? newPreCell(v) : v;
        write(l, t.personId, t.day, after);
        all.push({ personId: t.personId, day: t.day, before, after });
      }
    }
    if (!all.length) return 0;
    push({ layer: l, ym: ym.value, changes: all });
    commit(l, all, "貼上");
    return all.length;
  }

  function push(op: Op) {
    undoStack.value.push(op);
    if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift();
    redoStack.value = [];
  }

  function undo() {
    const op = undoStack.value.pop();
    if (!op || op.ym !== ym.value) return;
    for (const c of op.changes) write(op.layer, c.personId, c.day, c.before);
    redoStack.value.push(op);
    commit(op.layer, op.changes.map(c => ({ ...c, before: c.after, after: c.before })), "復原");
  }

  function redo() {
    const op = redoStack.value.pop();
    if (!op || op.ym !== ym.value) return;
    for (const c of op.changes) write(op.layer, c.personId, c.day, c.after);
    undoStack.value.push(op);
    commit(op.layer, op.changes, "重做");
  }

  function clearHistory() {
    undoStack.value = [];
    redoStack.value = [];
  }

  // ── 存檔與紀錄（合併 400ms 內的連續操作）────────────────────────
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pendingLogs: { action: string; detail: string }[] = [];
  const dirty = new Set<Layer>();

  const valOf = (x: string | PrebookCell | undefined) => (typeof x === "string" ? x : x?.v ?? "") || "空白";
  function describe(changes: Change[]): string {
    const d2 = (d: number) => `${Number(ym.value.slice(4))}/${d}`;
    const items = changes.slice(0, 6).map(c => `${personById(c.personId)?.name ?? "?"} ${d2(c.day)} ${valOf(c.before)}→${valOf(c.after)}`);
    return (changes.length > 6 ? `共 ${changes.length} 格：` : "") + items.join("、") + (changes.length > 6 ? "…" : "");
  }

  function commit(l: Layer, changes: Change[], action: string) {
    dirty.add(l);
    pendingLogs.push({ action: `${l === "pre" ? "預班" : "排班"}${action}`, detail: describe(changes) });
    if (timer) clearTimeout(timer);
    const theYm = ym.value;
    timer = setTimeout(() => flush(theYm), 400);
  }

  async function flush(theYm: string) {
    const logs = pendingLogs.splice(0);
    const layers = [...dirty];
    dirty.clear();
    try {
      if (layers.includes("pre") && store.prebooks[theYm]) await savePrebook(store.prebooks[theYm]);
      if (layers.includes("sched") && store.months[theYm]) {
        const m = store.months[theYm];
        const before = JSON.stringify(Object.fromEntries(Object.entries(m.markers).map(([k, v]) => [k, v.x])));
        const q = computeQuotas({
          month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems,
          cell: cellFnOf(m, store.prebooks[theYm]),
        });
        for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
        await saveMonth(m);
        const after = JSON.stringify(Object.fromEntries(Object.entries(m.markers).map(([k, v]) => [k, v.x])));
        if (before !== after && store.months[nextYm(theYm)]) await recompute(nextYm(theYm), `${theYm} 配額 X 變動`);
      }
      const actor = actorName();
      for (const lg of logs) await appendLog(theYm, lg.action, lg.detail, actor);
    } catch (e) {
      lastError.value = `儲存失敗：${(e as Error).message}`;
    }
  }

  return {
    month, prebook, editable, canEditCell, read, setCells, paste, undo, redo, clearHistory,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    lastError,
  };
}
