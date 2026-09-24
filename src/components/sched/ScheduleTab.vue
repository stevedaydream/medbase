<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useSchedStore, sortedYms, personById } from "@/composables/useSchedStore";
import { useSchedSession, getMachineId } from "@/composables/useSchedSession";
import {
  beginScheduling, acquireLock, publishMonth, revertMonth, revertDeadline, beginPostEdit, endPostEdit, createSwap,
  exportMonth, LockedError, type ExportKind,
} from "@/composables/useSchedFlow";
import type { Layer, CellRef, EditReason } from "@/composables/useGridEditor";
import { RULE_LABELS, type Issue, type RuleCode } from "@/shared/sched/engine/validate";
import { prevYm } from "@/shared/sched/calendar";
import SchedGrid from "./SchedGrid.vue";
import SidePanel from "./SidePanel.vue";
import MonthSettings from "./MonthSettings.vue";

const emit = defineEmits<{ toast: [msg: string] }>();
const store = useSchedStore();
const session = useSchedSession();
const isStaff = computed(() => session.role !== "employee");

const yms = computed(() => sortedYms());
function defaultYm() {
  const list = yms.value;
  return list.find(y => store.months[y].status === "scheduling")
    ?? list.find(y => store.months[y].status === "open")
    ?? list[list.length - 1] ?? "";
}
const ym = ref(defaultYm());
watch(yms, () => { if (!yms.value.includes(ym.value)) ym.value = defaultYm(); });
const month = computed(() => store.months[ym.value]);

const layer = ref<Layer>("sched");
watch(ym, () => {
  layer.value = month.value?.status === "open" ? "pre" : "sched";
  postEdit.value = false;
});
watch(() => month.value?.status, s => { if (s === "open") layer.value = "pre"; else if (s) layer.value = "sched"; }, { immediate: true });

// ── 排班鎖 ────────────────────────────────────────────────────
const machine = ref("");
onMounted(async () => { machine.value = await getMachineId(); });
const lock = computed(() => store.locks[ym.value] ?? null);
const hasLock = computed(() => !!lock.value && lock.value.machine === machine.value);
const lockedByOther = computed(() => !!lock.value && lock.value.machine !== machine.value);
const postEdit = ref(false);

const busy = ref(false);
async function run(fn: () => Promise<unknown>, ok?: string) {
  busy.value = true;
  try {
    await fn();
    if (ok) emit("toast", ok);
  } catch (e) {
    if (e instanceof LockedError) lockConflict.value = e.holder.name;
    else emit("toast", (e as Error).message);
  } finally {
    busy.value = false;
  }
}
const lockConflict = ref("");
const takeLock = (force = false) => run(async () => { await acquireLock(ym.value, force); lockConflict.value = ""; }, "已取得排班鎖");

// ── 開始排班 ─────────────────────────────────────────────────
const confirmForce = ref(false);
async function onStart(force = false) {
  busy.value = true;
  try {
    await beginScheduling(ym.value, force);
    confirmForce.value = false;
    emit("toast", "已開始排班：預班凍結並帶入排班層");
  } catch (e) {
    if (e instanceof LockedError) lockConflict.value = e.holder.name;
    else if ((e as Error).message === "上個月尚未發布") confirmForce.value = true;
    else emit("toast", (e as Error).message);
  } finally {
    busy.value = false;
  }
}

// ── 發布／退回 ───────────────────────────────────────────────
const issues = ref<Issue[]>([]);
const showPublish = ref(false);
const issueSummary = computed(() => {
  const c = new Map<RuleCode, number>();
  for (const i of issues.value) c.set(i.rule, (c.get(i.rule) ?? 0) + 1);
  return [...c.entries()].map(([r, n]) => `${RULE_LABELS[r]} ${n}`);
});
const doPublish = () => run(async () => {
  const r = await publishMonth(ym.value, issues.value.length);
  showPublish.value = false;
  emit("toast", r.sheet ? "已發布，手機可查看" : "已發布（未設定 GAS，手機看不到）");
});

const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 60_000);
onUnmounted(() => clearInterval(timer));
const revertLeft = computed(() => {
  const dl = month.value ? revertDeadline(month.value) : null;
  if (!dl || dl < now.value) return null;
  const h = Math.floor((dl - now.value) / 3600_000), m = Math.floor(((dl - now.value) % 3600_000) / 60_000);
  return `${h} 小時 ${m} 分`;
});
const doRevert = () => run(() => revertMonth(ym.value), "已退回排班中");
const startPostEdit = (force = false) => run(async () => { await beginPostEdit(ym.value, force); lockConflict.value = ""; postEdit.value = true; }, "已進入修改模式：每次修改需填原因，存檔後自動推送手機");
const stopPostEdit = () => run(async () => { await endPostEdit(ym.value); postEdit.value = false; }, "已結束修改");

// ── 發布後修改原因 ───────────────────────────────────────────
const reasonFor = ref(0);
const reasonText = ref("");
const reasonApproved = ref(false);
function closeReason(ok: boolean) {
  const r: EditReason | null = ok ? { text: reasonText.value, approved: reasonApproved.value } : null;
  if (ok && !reasonText.value.trim()) { emit("toast", "請填寫原因"); return; }
  grid.value?.confirmReason(r);
  reasonFor.value = 0;
  reasonText.value = "";
  reasonApproved.value = false;
}

// ── 換班 ─────────────────────────────────────────────────────
const swapCell = ref<CellRef | null>(null);
const swapWith = ref("");
const swapNote = ref("");
const code = (id: string, d: number) => month.value?.schedule[id]?.[d - 1] || "空白";
const swapCandidates = computed(() =>
  (month.value?.roster ?? []).filter(r => r.flags.active && r.personId !== swapCell.value?.personId));
const doSwap = () => run(async () => {
  if (!swapCell.value || !swapWith.value) return;
  await createSwap(ym.value, swapCell.value.day, swapCell.value.personId, swapWith.value, swapNote.value.trim());
  swapCell.value = null; swapWith.value = ""; swapNote.value = "";
}, "已建立換班");

// ── 匯出 ─────────────────────────────────────────────────────
const showExport = ref(false);
const doExport = (k: ExportKind) => { showExport.value = false; return run(async () => { const p = await exportMonth(ym.value, k); if (p) emit("toast", `已匯出：${p.split(/[\\/]/).pop()}`); }); };

// ── 其他 ─────────────────────────────────────────────────────
const showInactive = ref(false);
const showSettings = ref(false);
const focus = ref<CellRef | null>(null);
const grid = ref<InstanceType<typeof SchedGrid> | null>(null);
const side = ref<InstanceType<typeof SidePanel> | null>(null);
const STATUS = { open: "開放預班", scheduling: "排班中", published: "已發布" } as const;
const idx = computed(() => yms.value.indexOf(ym.value));
function step(d: number) { const n = yms.value[idx.value + d]; if (n) ym.value = n; }
function onGoto(c: CellRef) { focus.value = c; grid.value?.goTo(c); }
const lockTime = computed(() => lock.value ? new Date(lock.value.at).toLocaleString() : "");
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-hairline text-xs flex-shrink-0 flex-wrap">
      <button class="px-1.5 text-muted hover:text-fg disabled:opacity-30" :disabled="idx <= 0" @click="step(-1)">◀</button>
      <select v-model="ym" class="sched-input font-semibold">
        <option v-for="y in yms" :key="y" :value="y">{{ y.slice(0, 4) }}/{{ y.slice(4) }}</option>
      </select>
      <button class="px-1.5 text-muted hover:text-fg disabled:opacity-30" :disabled="idx >= yms.length - 1" @click="step(1)">▶</button>
      <span v-if="month" class="px-2 py-0.5 rounded-full border"
        :class="month.status === 'open' ? 'border-accent text-accent' : month.status === 'scheduling' ? 'border-warning text-warning' : 'border-success text-success'">
        {{ STATUS[month.status] }}{{ postEdit ? "・修改中" : "" }}
      </span>

      <div v-if="month && month.status !== 'open'" class="flex border border-hairline rounded overflow-hidden ml-1">
        <button v-for="l in (['sched', 'pre'] as const)" :key="l" class="px-2.5 py-1"
          :class="layer === l ? 'bg-accent text-white' : 'text-muted hover:bg-elevated'" @click="layer = l">
          {{ l === "sched" ? "排班層" : "預班層（凍結）" }}
        </button>
      </div>
      <label class="flex items-center gap-1 text-muted ml-1"><input v-model="showInactive" type="checkbox" />顯示非在職</label>

      <!-- 排班鎖狀態 -->
      <span v-if="isStaff && lock && hasLock" class="text-success">🔒 本機持有排班鎖</span>
      <span v-else-if="isStaff && lockedByOther" class="text-warning" :title="lockTime">🔒 {{ lock!.name }} 正在排班</span>

      <div class="ml-auto flex items-center gap-2">
        <button class="px-2 py-1 text-muted hover:text-fg disabled:opacity-30" :disabled="!grid?.canUndo" title="復原 Ctrl+Z" @click="grid?.undo()">↶</button>
        <button class="px-2 py-1 text-muted hover:text-fg disabled:opacity-30" :disabled="!grid?.canRedo" title="重做 Ctrl+Y" @click="grid?.redo()">↷</button>
        <template v-if="isStaff && month">
          <div class="relative">
            <button class="px-2.5 py-1 border border-hairline rounded hover:bg-elevated" @click="showExport = !showExport">匯出 ▾</button>
            <div v-if="showExport" class="absolute right-0 top-8 z-40 w-56 bg-surface border border-hairline rounded-lg shadow-2xl py-1">
              <button class="w-full text-left px-3 py-1.5 hover:bg-elevated" @click="doExport('app')">班表 XLSX（含 8-4／春節明細）</button>
              <button class="w-full text-left px-3 py-1.5 hover:bg-elevated" @click="doExport('positional')">Excel 完整格式（過渡期貼回用）</button>
            </div>
          </div>
          <button class="px-2.5 py-1 border border-hairline rounded hover:bg-elevated" @click="showSettings = true">本月設定</button>
          <button v-if="month.status === 'open'" class="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-40"
            :disabled="busy" @click="onStart()">開始排班</button>
          <template v-if="month.status === 'scheduling'">
            <button v-if="!hasLock" class="px-2.5 py-1 border border-warning/60 text-warning rounded disabled:opacity-40" :disabled="busy" @click="takeLock()">取得排班鎖</button>
            <button v-else class="px-3 py-1 bg-success hover:bg-success-hover text-white rounded disabled:opacity-40" :disabled="busy" @click="showPublish = true">發布…</button>
          </template>
          <template v-if="month.status === 'published'">
            <button v-if="revertLeft && !postEdit" class="px-2.5 py-1 border border-hairline rounded hover:bg-elevated disabled:opacity-40" :disabled="busy"
              :title="`發布後 ${store.rules.revertHours} 小時內可退回`" @click="doRevert">退回（剩 {{ revertLeft }}）</button>
            <button v-if="!postEdit" class="px-2.5 py-1 border border-warning/60 text-warning rounded disabled:opacity-40" :disabled="busy" @click="startPostEdit()">修改已發布班表</button>
            <button v-else class="px-3 py-1 bg-accent text-white rounded disabled:opacity-40" :disabled="busy" @click="stopPostEdit">結束修改</button>
          </template>
        </template>
      </div>
    </div>

    <div v-if="lockConflict" class="flex items-center gap-2 px-3 py-2 bg-warning/10 border-b border-warning/40 text-xs">
      <span class="text-warning">{{ lockConflict }} 正在這個月份排班。強制接手會讓對方的電腦無法再存檔，請先確認對方已離開。</span>
      <button class="px-2 py-1 border border-warning/60 rounded text-warning" @click="month?.status === 'published' ? startPostEdit(true) : takeLock(true)">強制接手</button>
      <button class="px-2 py-1 text-muted" @click="lockConflict = ''">取消</button>
    </div>
    <div v-if="confirmForce" class="flex items-center gap-2 px-3 py-2 bg-warning/10 border-b border-warning/40 text-xs">
      <span class="text-warning">{{ prevYm(ym) }} 尚未發布，配額餘數的交接依據（X）還沒定案。</span>
      <button class="px-2 py-1 border border-warning/60 rounded text-warning" @click="onStart(true)">強制以目前 X 暫時交接</button>
      <button class="px-2 py-1 text-muted" @click="confirmForce = false">取消</button>
    </div>

    <div v-if="!month" class="flex-1 flex items-center justify-center text-sm text-muted">尚無月份，請到「月份與輪值」新增或從 Excel 匯入</div>
    <div v-else class="flex-1 flex overflow-hidden">
      <div class="flex-1 overflow-hidden">
        <SchedGrid ref="grid" :ym="ym" :layer="layer" :show-inactive="showInactive" :has-lock="hasLock" :post-edit="postEdit"
          @toast="m => emit('toast', m)" @issues="v => (issues = v)" @focus="c => (focus = c)"
          @showlog="c => { focus = c; side?.showLog(); }" @needreason="n => (reasonFor = n)" @swap="c => (swapCell = c)" />
      </div>
      <div class="w-80 flex-shrink-0">
        <SidePanel ref="side" :ym="ym" :issues="issues" :focus="focus" @goto="onGoto" />
      </div>
    </div>

    <MonthSettings v-if="showSettings && month" :ym="ym" @close="showSettings = false" @toast="m => emit('toast', m)" />

    <!-- 發布確認 -->
    <div v-if="showPublish" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm text-xs">
      <div class="bg-surface border border-hairline rounded-xl shadow-2xl p-5 w-[28rem] space-y-3">
        <h3 class="text-sm font-semibold text-fg">發布 {{ ym }}</h3>
        <p class="text-fg-secondary">發布後配額與 X 定案、交給下個月交接，手機即可查看；{{ store.rules.revertHours }} 小時內可退回，之後只能加註記修改。</p>
        <div v-if="issues.length" class="border border-warning/50 rounded p-2 bg-warning/5">
          <div class="text-warning font-semibold mb-1">仍有 {{ issues.length }} 項檢核警告：</div>
          <div v-for="s in issueSummary" :key="s" class="text-fg-secondary">・{{ s }}</div>
        </div>
        <div v-else class="text-success">沒有檢核警告 ✓</div>
        <div class="flex justify-end gap-2">
          <button class="px-3 py-1.5 text-muted" @click="showPublish = false">取消</button>
          <button class="px-3 py-1.5 bg-success hover:bg-success-hover text-white rounded disabled:opacity-40" :disabled="busy" @click="doPublish">
            {{ issues.length ? "確認仍要發布" : "發布" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 發布後修改原因 -->
    <div v-if="reasonFor" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm text-xs">
      <div class="bg-surface border border-hairline rounded-xl shadow-2xl p-5 w-[26rem] space-y-3">
        <h3 class="text-sm font-semibold text-fg">修改已發布班表（{{ reasonFor }} 格）</h3>
        <textarea v-model="reasonText" rows="3" placeholder="修改原因（必填），例如：病假由 OO 代班" class="sched-input w-full" />
        <label class="flex items-center gap-1.5 text-fg-secondary">
          <input v-model="reasonApproved" type="checkbox" />核准偏離：此人配額不符不再警告
        </label>
        <div class="flex justify-end gap-2">
          <button class="px-3 py-1.5 text-muted" @click="closeReason(false)">取消</button>
          <button class="px-3 py-1.5 bg-accent text-white rounded" @click="closeReason(true)">確定修改</button>
        </div>
      </div>
    </div>

    <!-- 換班 -->
    <div v-if="swapCell" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm text-xs">
      <div class="bg-surface border border-hairline rounded-xl shadow-2xl p-5 w-[26rem] space-y-3">
        <h3 class="text-sm font-semibold text-fg">建立換班：{{ Number(ym.slice(4)) }}/{{ swapCell.day }}</h3>
        <p class="text-fg-secondary">
          {{ personById(swapCell.personId)?.name }}（{{ code(swapCell.personId, swapCell.day) }}）與下列人員互換當天班別，
          兩人的配額目標會自動調整；跨月未抵銷的部分在發布時記為欠班。
        </p>
        <select v-model="swapWith" class="sched-input w-full">
          <option value="">選擇對象…</option>
          <option v-for="r in swapCandidates" :key="r.personId" :value="r.personId">
            {{ personById(r.personId)?.name }}（{{ code(r.personId, swapCell.day) }}）
          </option>
        </select>
        <input v-model="swapNote" placeholder="備註（選填）" class="sched-input w-full" />
        <div class="flex justify-end gap-2">
          <button class="px-3 py-1.5 text-muted" @click="swapCell = null">取消</button>
          <button class="px-3 py-1.5 bg-accent text-white rounded disabled:opacity-40" :disabled="!swapWith || busy" @click="doSwap">互換</button>
        </div>
      </div>
    </div>
  </div>
</template>
