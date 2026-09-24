<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useSchedStore, personById, saveMonth, appendLog, actorName, recompute } from "@/composables/useSchedStore";
import { useGridEditor, type Layer, type CellRef, type EditReason } from "@/composables/useGridEditor";
import { targetsWithSwaps } from "@/shared/sched/engine/swaps";
import { computeQuotas } from "@/shared/sched/engine/quota";
import { cellFnOf } from "@/shared/sched/engine/prefill";
import { needOf } from "@/shared/sched/engine/staffing";
import { validate, personStats, dayStats, shiftMap, type Issue, type GridCtx } from "@/shared/sched/engine/validate";
import { daysIn, dayTypeOf, dowOf, dateStr, WEEKDAY_LABEL, inCny, prevYm } from "@/shared/sched/calendar";
import { colorOf } from "@/shared/sched/palette";
import { cellKey, CONSTRAINT_MARKS, FLAG_DEFS, type Flags } from "@/shared/sched/types";

const props = defineProps<{ ym: string; layer: Layer; showInactive: boolean; hasLock: boolean; postEdit: boolean }>();
const emit = defineEmits<{
  toast: [msg: string]; issues: [list: Issue[]]; focus: [cell: CellRef | null]; showlog: [cell: CellRef];
  needreason: [count: number]; swap: [cell: CellRef];
}>();

const store = useSchedStore();
const ymRef = computed(() => props.ym);
const layerRef = computed(() => props.layer);
const ed = useGridEditor(ymRef, layerRef, computed(() => props.hasLock), computed(() => props.postEdit));

const nd = computed(() => daysIn(props.ym));
const days = computed(() => Array.from({ length: nd.value }, (_, i) => i + 1));
const rows = computed(() => (ed.month.value?.roster ?? []).filter(r => props.showInactive || r.flags.active));
const rowIds = computed(() => rows.value.map(r => r.personId));
const sm = computed(() => shiftMap(store.shifts));
const items = computed(() => store.quotaItems.filter(i => i.enabled));

// ── 資料與檢核 ────────────────────────────────────────────────
const isMark = (v: string) => (CONSTRAINT_MARKS as readonly string[]).includes(v);
const cellFn = computed(() => {
  const m = ed.month.value, pb = ed.prebook.value;
  if (!m) return () => "";
  if (props.layer === "pre") return (id: string, d: number) => { const v = pb?.cells[cellKey(id, d)]?.v ?? ""; return isMark(v) ? "" : v; };
  return (id: string, d: number) => m.schedule[id]?.[d - 1] ?? "";
});

const quota = computed(() => {
  const m = ed.month.value;
  if (!m) return null;
  return computeQuotas({ month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems, cell: cellFnOf(m, ed.prebook.value) });
});
const targets = computed(() => {
  const m = ed.month.value;
  if (!m) return {};
  const base = m.status === "published" && m.frozenQuotas ? m.frozenQuotas : quota.value?.quotas ?? {};
  return targetsWithSwaps(base, m, items.value);
});
const approved = computed(() => new Set((ed.month.value?.changeLog ?? []).filter(c => c.approved).map(c => c.personId)));
const changedCells = computed(() => new Set((ed.month.value?.changeLog ?? []).map(c => `${c.personId}|${c.day}`)));
const swapCells = computed(() => new Set((ed.month.value?.swaps ?? []).flatMap(s => [`${s.a}|${s.day}`, `${s.b}|${s.day}`])));

const prevTail = computed(() => {
  const pm = store.months[prevYm(props.ym)];
  if (!pm) return undefined;
  const pnd = daysIn(pm.ym);
  return Object.fromEntries(Object.entries(pm.schedule).map(([id, arr]) => [id, arr.slice(Math.max(0, pnd - 7))]));
});

const ctx = computed<GridCtx | null>(() => {
  const m = ed.month.value;
  if (!m || !quota.value) return null;
  return {
    month: m, prebook: ed.prebook.value, holidays: store.holidays, shifts: store.shifts, items: items.value,
    rules: store.rules, cell: cellFn.value, prevTail: prevTail.value, targets: targets.value,
    offSlots: quota.value.offSlots, name: id => personById(id)?.name ?? "?", approved: approved.value,
  };
});
const issues = computed(() => (ctx.value ? validate(ctx.value) : []));
watch(issues, v => emit("issues", v), { immediate: true });
const issueAt = computed(() => {
  const map = new Map<string, Issue[]>();
  for (const i of issues.value) {
    if (!i.personId || !i.day) continue;
    const k = `${i.personId}|${i.day}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return map;
});
const dayIssue = computed(() => new Set(issues.value.filter(i => !i.personId && i.day).map(i => i.day!)));

const stats = computed(() => Object.fromEntries(rows.value.map(r => [r.personId, ctx.value ? personStats(ctx.value, r.personId) : null])));
const needs = computed(() => { const m = ed.month.value; return m ? days.value.map(d => needOf(m, d, store.holidays)) : []; });
const dstats = computed(() => days.value.map(d => (ctx.value ? dayStats(ctx.value, d) : { D: 0, N: 0, S1: 0, off: 0 })));

// ── 表頭 ─────────────────────────────────────────────────────
function dayHead(d: number) {
  const date = dateStr(props.ym, d);
  const dt = dayTypeOf(props.ym, d, store.holidays);
  const tags: string[] = [];
  if (inCny(store.holidays, date)) tags.push("春節");
  else if (store.holidays.days[date]) tags.push(store.holidays.days[date].slice(0, 3));
  if (store.duty84.log.some(e => e.date === date)) tags.push("8-4");
  return { dow: WEEKDAY_LABEL[dowOf(props.ym, d)], rest: dt !== "weekday", tag: tags.join(" ") };
}
const heads = computed(() => days.value.map(dayHead));

// ── 格子樣式 ─────────────────────────────────────────────────
function display(id: string, d: number): string {
  return ed.read(props.layer, id, d);
}
function cellStyle(id: string, d: number) {
  const v = display(id, d);
  const s = sm.value.get(v);
  if (!s) return {};
  const c = colorOf(s.color);
  return { backgroundColor: c.bg, color: c.text };
}
function origin(id: string, d: number): "pre" | "sys" | "" {
  const c = ed.prebook.value?.cells[cellKey(id, d)];
  if (!c?.v || isMark(c.v)) return "";
  if (props.layer === "pre") return c.src === "sys" ? "sys" : "";
  return display(id, d) === c.v ? (c.src === "sys" ? "sys" : "pre") : "";
}
function markOf(id: string, d: number): string {
  if (props.layer === "pre") return "";
  const v = ed.prebook.value?.cells[cellKey(id, d)]?.v ?? "";
  return isMark(v) ? v : "";
}
const flagShort = (f: Flags) => FLAG_DEFS.filter(x => x.key !== "active" && f[x.key]).map(x => x.short).join(" ");

// ── 選取 ─────────────────────────────────────────────────────
const anchor = ref<CellRef | null>(null);
const focusCell = ref<CellRef | null>(null);
let dragging = false;
const moved = ref(false);
const hoverRow = ref<string | null>(null);

const selRect = computed(() => {
  if (!anchor.value || !focusCell.value) return null;
  const ri = [rowIds.value.indexOf(anchor.value.personId), rowIds.value.indexOf(focusCell.value.personId)];
  if (ri.some(i => i < 0)) return null;
  return {
    r1: Math.min(...ri), r2: Math.max(...ri),
    d1: Math.min(anchor.value.day, focusCell.value.day), d2: Math.max(anchor.value.day, focusCell.value.day),
  };
});
const selCells = computed<CellRef[]>(() => {
  const r = selRect.value;
  if (!r) return [];
  const out: CellRef[] = [];
  for (let i = r.r1; i <= r.r2; i++) for (let d = r.d1; d <= r.d2; d++) out.push({ personId: rowIds.value[i], day: d });
  return out;
});
function isSel(id: string, d: number) {
  const r = selRect.value;
  if (!r) return false;
  const i = rowIds.value.indexOf(id);
  return i >= r.r1 && i <= r.r2 && d >= r.d1 && d <= r.d2;
}

function onDown(e: MouseEvent, id: string, d: number) {
  if (e.button !== 0) return;
  e.preventDefault();
  closeMenus();
  if (e.shiftKey && anchor.value) { focusCell.value = { personId: id, day: d }; return; }
  anchor.value = { personId: id, day: d };
  focusCell.value = { personId: id, day: d };
  dragging = true;
  moved.value = false;
  emit("focus", anchor.value);
}
function onEnter(id: string, d: number) {
  hoverRow.value = id;
  if (!dragging) return;
  if (focusCell.value?.personId !== id || focusCell.value?.day !== d) moved.value = true;
  focusCell.value = { personId: id, day: d };
}
function onUp(e: MouseEvent) {
  if (!dragging) return;
  dragging = false;
  if (!ed.editable.value) return;
  if (selCells.value.length > 1) {
    batch.value = { x: e.clientX, y: e.clientY };
  } else if (!moved.value && anchor.value && ed.canEditCell(anchor.value.personId, anchor.value.day)) {
    const td = (e.target as HTMLElement).closest("[data-cell]") as HTMLElement | null;
    if (td) {
      const rc = td.getBoundingClientRect();
      radial.value = { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
    }
  }
}

// ── 選單 ─────────────────────────────────────────────────────
const radial = ref<{ x: number; y: number } | null>(null);
const batch = ref<{ x: number; y: number } | null>(null);
const ctxMenu = ref<{ x: number; y: number; cell: CellRef } | null>(null);
function closeMenus() { radial.value = null; batch.value = null; ctxMenu.value = null; }

const menuCodes = computed(() => {
  // 預班層不提供 8-4 類（系統輪值決定）
  if (props.layer === "pre") return [...store.shifts.filter(s => !s.reducesOff).map(s => s.code), ...CONSTRAINT_MARKS];
  return store.shifts.map(s => s.code);
});
function codeStyle(code: string) {
  const s = sm.value.get(code);
  if (!s) return { backgroundColor: "var(--color-elevated)", color: "var(--color-danger)", border: "1.5px solid var(--color-danger)" };
  const c = colorOf(s.color);
  return { backgroundColor: c.bg, color: c.text, border: `1.5px solid ${c.text}` };
}
function radialPos(i: number, total: number) {
  const radius = total > 8 ? 52 : 44;
  const a = (2 * Math.PI * i) / total - Math.PI / 2;
  return { left: `${Math.cos(a) * radius - 18}px`, top: `${Math.sin(a) * radius - 18}px` };
}

const pendingApply = ref<{ cells: CellRef[]; code: string } | null>(null);
function apply(code: string) {
  if (ed.needsReason.value) {
    pendingApply.value = { cells: [...selCells.value], code };
    closeMenus();
    emit("needreason", selCells.value.length);
    return;
  }
  const n = ed.setCells(selCells.value, code, selCells.value.length > 1 ? "批次改格" : "改格");
  if (ed.lastError.value) emit("toast", ed.lastError.value);
  else if (n > 1) emit("toast", `已設定 ${n} 格`);
  closeMenus();
}

function onContext(e: MouseEvent, id: string, d: number) {
  e.preventDefault();
  if (!isSel(id, d)) { anchor.value = { personId: id, day: d }; focusCell.value = { personId: id, day: d }; }
  radial.value = null; batch.value = null;
  ctxMenu.value = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 360), cell: { personId: id, day: d } };
  emit("focus", { personId: id, day: d });
}
function showCellLog() {
  if (ctxMenu.value) emit("showlog", ctxMenu.value.cell);
  closeMenus();
}

/** 發布後修改：填完原因後套用 */
function confirmReason(reason: EditReason | null) {
  const p = pendingApply.value;
  pendingApply.value = null;
  if (!p || !reason) return;
  const n = ed.setCells(p.cells, p.code, p.cells.length > 1 ? "批次改格" : "改格", reason);
  emit("toast", ed.lastError.value || `已修改 ${n} 格，將自動重新發布到手機`);
}
function requestSwap() {
  if (ctxMenu.value) emit("swap", ctxMenu.value.cell);
  closeMenus();
}

// ── 鍵盤 ─────────────────────────────────────────────────────
let clipboard: string[][] | null = null;
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  if (e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); ed.undo(); return; }
  if (e.ctrlKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); ed.redo(); return; }
  if (!selCells.value.length) return;
  if (e.key === "Escape") { closeMenus(); anchor.value = null; focusCell.value = null; return; }
  if (e.ctrlKey && e.key.toLowerCase() === "c") {
    const r = selRect.value!;
    clipboard = [];
    for (let i = r.r1; i <= r.r2; i++) {
      const line: string[] = [];
      for (let d = r.d1; d <= r.d2; d++) line.push(display(rowIds.value[i], d));
      clipboard.push(line);
    }
    emit("toast", `已複製 ${selCells.value.length} 格`);
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === "v") {
    if (!clipboard || !selRect.value) return;
    const r = selRect.value;
    const n = ed.paste({ personId: rowIds.value[r.r1], day: r.d1 }, rowIds.value, clipboard);
    emit("toast", n ? `已貼上 ${n} 格` : ed.lastError.value || "沒有可貼上的格子");
    return;
  }
  if (e.key.startsWith("Arrow") && !e.ctrlKey) {
    e.preventDefault();
    const cur = focusCell.value!;
    let ri = rowIds.value.indexOf(cur.personId), d = cur.day;
    if (e.key === "ArrowUp") ri = Math.max(0, ri - 1);
    if (e.key === "ArrowDown") ri = Math.min(rowIds.value.length - 1, ri + 1);
    if (e.key === "ArrowLeft") d = Math.max(1, d - 1);
    if (e.key === "ArrowRight") d = Math.min(nd.value, d + 1);
    const next = { personId: rowIds.value[ri], day: d };
    focusCell.value = next;
    if (!e.shiftKey) anchor.value = next;
    closeMenus();
    emit("focus", next);
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); apply(""); return; }
  const hit = store.shifts.find(s => s.hotkey && s.hotkey.toLowerCase() === e.key.toLowerCase());
  if (hit) { e.preventDefault(); apply(hit.code); }
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  document.addEventListener("mouseup", onUp);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  document.removeEventListener("mouseup", onUp);
});
watch(() => props.ym, () => { ed.clearHistory(); anchor.value = null; focusCell.value = null; closeMenus(); });

// ── 可休單日微調 ─────────────────────────────────────────────
async function adjustDay(d: number, delta: number) {
  const m = ed.month.value;
  if (!m || m.status === "published") return;
  const v = (m.staffing.dayAdjust[d] ?? 0) + delta;
  if (v === 0) delete m.staffing.dayAdjust[d]; else m.staffing.dayAdjust[d] = v;
  await saveMonth(m);
  await appendLog(m.ym, "可休微調", `${Number(m.ym.slice(4))}/${d} 可休 ${delta > 0 ? "+1" : "−1"}（微調合計 ${v >= 0 ? "+" : ""}${v}）`, actorName());
  if (m.status === "open") await recompute(m.ym, `${m.ym} 單日可休微調`);
}

// 供外部（問題清單）跳到某格
const gridEl = ref<HTMLElement | null>(null);
function goTo(c: CellRef) {
  anchor.value = c; focusCell.value = c;
  nextTick(() => {
    gridEl.value?.querySelector(`[data-cell="${c.personId}|${c.day}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  });
}
defineExpose({ goTo, undo: ed.undo, redo: ed.redo, canUndo: ed.canUndo, canRedo: ed.canRedo, confirmReason });

const statusOf = (id: string, itemId: string) => {
  const act = stats.value[id]?.counts[itemId] ?? 0;
  const t = targets.value[id]?.[itemId];
  if (t === undefined) return { text: String(act), cls: "text-fg-secondary" };
  return { text: `${act}/${t}`, cls: act === t ? "text-success" : act > t ? "text-danger" : "text-warning" };
};
</script>

<template>
  <div ref="gridEl" class="h-full overflow-auto select-none" @mouseleave="hoverRow = null">
    <table v-if="ed.month.value" class="sched-grid text-xs border-separate border-spacing-0">
      <thead class="sticky top-0 z-20 bg-surface">
        <tr>
          <th class="sticky left-0 z-30 bg-surface text-left px-2 min-w-[8.5rem]" rowspan="2">
            {{ layer === "pre" ? "預班層" : "排班層" }}
          </th>
          <th v-for="(h, i) in heads" :key="'d' + i" class="w-9 min-w-[2.25rem] font-semibold pt-1"
            :class="[h.rest ? 'text-danger' : 'text-fg-secondary', dayIssue.has(i + 1) ? 'bg-danger/10' : '']">{{ i + 1 }}</th>
          <th v-for="it in items" :key="it.id" rowspan="2" class="px-1.5 text-muted font-medium whitespace-nowrap">{{ it.name }}</th>
          <th rowspan="2" class="px-1.5 text-muted font-medium">總時</th>
        </tr>
        <tr>
          <th v-for="(h, i) in heads" :key="'w' + i" class="font-normal pb-1 border-b border-hairline leading-tight" :class="h.rest ? 'text-danger' : 'text-muted'">
            {{ h.dow }}<div class="text-2xs text-accent h-3 overflow-hidden">{{ h.tag }}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.personId" :class="[hoverRow === r.personId ? 'row-hover' : '', r.flags.active ? '' : 'opacity-40']">
          <td class="sticky left-0 z-10 bg-surface px-2 py-0.5 whitespace-nowrap border-b border-hairline">
            <span class="font-medium text-fg">{{ personById(r.personId)?.name }}</span>
            <span class="ml-1 text-2xs text-muted">{{ r.flags.active ? flagShort(r.flags) : "非在職" }}</span>
          </td>
          <td v-for="d in days" :key="d" :data-cell="`${r.personId}|${d}`"
            class="cell h-7 text-center font-semibold border-b border-r border-hairline relative cursor-pointer"
            :class="[
              isSel(r.personId, d) ? 'is-sel' : '',
              issueAt.has(`${r.personId}|${d}`) ? 'is-bad' : '',
              origin(r.personId, d) === 'pre' ? 'is-pre' : '',
              origin(r.personId, d) === 'sys' ? 'is-sys' : '',
              heads[d - 1].rest ? 'is-rest' : '',
            ]"
            :style="cellStyle(r.personId, d)"
            :title="issueAt.get(`${r.personId}|${d}`)?.map(i => i.message).join('\n')"
            @mousedown="onDown($event, r.personId, d)" @mouseenter="onEnter(r.personId, d)"
            @contextmenu="onContext($event, r.personId, d)">
            <span :class="isMark(display(r.personId, d)) ? 'text-danger text-2xs' : ''">{{ display(r.personId, d) }}</span>
            <span v-if="markOf(r.personId, d)" class="absolute top-0 right-0.5 text-2xs text-danger leading-none">{{ markOf(r.personId, d) === "勿休" ? "⊘休" : "⊘值" }}</span>
            <span v-if="layer === 'sched' && swapCells.has(`${r.personId}|${d}`)" class="absolute bottom-0 left-0.5 text-2xs leading-none text-warning" title="換班">⇄</span>
            <span v-if="layer === 'sched' && changedCells.has(`${r.personId}|${d}`)" class="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-warning" title="發布後修改過"></span>
          </td>
          <td v-for="it in items" :key="it.id" class="px-1.5 text-center tabular-nums border-b border-hairline" :class="statusOf(r.personId, it.id).cls">
            {{ r.flags.active ? statusOf(r.personId, it.id).text : "" }}
          </td>
          <td class="px-1.5 text-center tabular-nums text-fg-secondary border-b border-hairline">{{ r.flags.active ? stats[r.personId]?.hours : "" }}</td>
        </tr>
      </tbody>
      <tfoot class="sticky bottom-0 z-20 bg-surface">
        <tr>
          <td class="sticky left-0 z-30 bg-surface px-2 text-muted border-t border-hairline">可休</td>
          <td v-for="d in days" :key="d" class="text-center tabular-nums border-t border-hairline group relative"
            :class="ed.month.value.staffing.dayAdjust[d] ? 'text-accent font-semibold' : 'text-fg-secondary'"
            :title="ed.month.value.staffing.dayAdjust[d] ? `已微調 ${ed.month.value.staffing.dayAdjust[d]}` : '滑到此處可 ±1 微調'">
            {{ quota?.offSlots[d - 1] }}
            <span v-if="ed.month.value.status !== 'published'" class="absolute inset-x-0 -top-3 hidden group-hover:flex justify-center gap-0.5">
              <button class="w-4 h-4 leading-none rounded bg-elevated border border-hairline" @click="adjustDay(d, 1)">+</button>
              <button class="w-4 h-4 leading-none rounded bg-elevated border border-hairline" @click="adjustDay(d, -1)">−</button>
            </span>
          </td>
        </tr>
        <tr>
          <td class="sticky left-0 z-30 bg-surface px-2 text-muted">已休</td>
          <td v-for="d in days" :key="d" class="text-center tabular-nums"
            :class="dstats[d - 1].off > (quota?.offSlots[d - 1] ?? 0) ? 'text-danger font-semibold' : 'text-fg-secondary'">{{ dstats[d - 1].off }}</td>
        </tr>
        <tr v-for="k in (layer === 'sched' ? (['D', 'N', 'S1'] as const) : [])" :key="k">
          <td class="sticky left-0 z-30 bg-surface px-2 text-muted">{{ k }}</td>
          <td v-for="d in days" :key="d" class="text-center tabular-nums"
            :class="layer === 'sched' && dstats[d - 1][k] !== needs[d - 1]?.[k] ? 'text-danger font-semibold' : 'text-fg-secondary'"
            :title="`需 ${needs[d - 1]?.[k]}`">{{ dstats[d - 1][k] }}</td>
        </tr>
      </tfoot>
    </table>

    <!-- 環形選單 -->
    <div v-if="radial" class="fixed inset-0 z-50" @mousedown.self="closeMenus">
      <div class="absolute" :style="{ left: radial.x + 'px', top: radial.y + 'px' }">
        <button v-for="(code, i) in menuCodes" :key="code"
          class="absolute w-9 h-9 rounded-full text-2xs font-bold flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
          :style="{ ...radialPos(i, menuCodes.length), ...codeStyle(code) }" @click="apply(code)">{{ code }}</button>
        <button class="absolute w-8 h-8 rounded-full bg-surface border-2 border-hairline text-muted hover:text-danger hover:border-danger shadow-lg"
          style="left:-16px;top:-16px" title="清除" @click="apply('')">×</button>
      </div>
    </div>

    <!-- 批次選單 -->
    <div v-if="batch" class="fixed z-50" :style="{ left: Math.min(batch.x, 900) + 'px', top: batch.y - 52 + 'px' }">
      <div class="flex items-center gap-1 bg-surface border border-hairline rounded-xl shadow-2xl px-3 py-2">
        <span class="text-xs text-muted pr-1.5 border-r border-hairline">{{ selCells.length }} 格</span>
        <button v-for="code in menuCodes" :key="code" class="text-xs font-bold px-2 py-1 rounded-lg hover:scale-110 transition-transform"
          :style="codeStyle(code)" @click="apply(code)">{{ code }}</button>
        <button class="text-xs px-2 py-1 rounded-lg border border-hairline text-muted hover:text-danger" @click="apply('')">清除</button>
        <button class="text-xs px-1.5 text-muted" @click="closeMenus">✕</button>
      </div>
    </div>

    <!-- 右鍵選單 -->
    <div v-if="ctxMenu" class="fixed inset-0 z-50" @mousedown.self="closeMenus" @contextmenu.prevent="closeMenus">
      <div class="absolute w-52 bg-surface border border-hairline rounded-lg shadow-2xl py-1 text-xs" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <div class="px-3 py-1 text-muted">{{ personById(ctxMenu.cell.personId)?.name }}　{{ Number(ym.slice(4)) }}/{{ ctxMenu.cell.day }}{{ selCells.length > 1 ? `（${selCells.length} 格）` : "" }}</div>
        <template v-if="ed.editable.value">
          <div class="grid grid-cols-5 gap-1 px-2 py-1">
            <button v-for="code in menuCodes" :key="code" class="py-1 rounded text-2xs font-bold" :style="codeStyle(code)" @click="apply(code)">{{ code }}</button>
          </div>
          <button class="w-full text-left px-3 py-1.5 hover:bg-elevated" @click="apply('')">清除</button>
          <button v-if="layer === 'sched' && selCells.length === 1" class="w-full text-left px-3 py-1.5 hover:bg-elevated" @click="requestSwap">建立換班（同日與另一人互換）…</button>
        </template>
        <div v-else class="px-3 py-1.5 text-muted">此月份目前不可編輯</div>
        <button class="w-full text-left px-3 py-1.5 hover:bg-elevated" @click="showCellLog">查看此格紀錄</button>
        <div v-for="i in issueAt.get(`${ctxMenu.cell.personId}|${ctxMenu.cell.day}`) ?? []" :key="i.message" class="px-3 py-1 text-danger">⚠ {{ i.message }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sched-grid td.cell { transition: box-shadow 0.08s; }
.sched-grid td.is-rest:not([style*="background"]) { background: color-mix(in srgb, var(--color-danger) 5%, transparent); }
.sched-grid td.is-pre span:first-child { color: var(--color-danger) !important; }
.sched-grid td.is-sys { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-muted) 55%, transparent); font-style: italic; }
.sched-grid td.is-bad { box-shadow: inset 0 0 0 2px var(--color-danger); }
.sched-grid td.is-sel { box-shadow: inset 0 0 0 2px var(--color-accent); filter: brightness(1.15); }
.sched-grid tr.row-hover td:first-child { background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)); }
.sched-grid tr.row-hover td.cell:not([style*="background"]) { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }
</style>
