<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useSchedStore, sortedYms, startMonth } from "@/composables/useSchedStore";
import { useSchedSession } from "@/composables/useSchedSession";
import type { Layer, CellRef } from "@/composables/useGridEditor";
import type { Issue } from "@/utils/sched/engine/validate";
import { prevYm } from "@/utils/sched/calendar";
import SchedGrid from "./SchedGrid.vue";
import SidePanel from "./SidePanel.vue";
import MonthSettings from "./MonthSettings.vue";

const emit = defineEmits<{ toast: [msg: string] }>();
const store = useSchedStore();
const session = useSchedSession();
const isStaff = computed(() => session.role !== "employee");

const yms = computed(() => sortedYms());
/** 預設：最早的排班中月份，其次最早的開放月份，最後為最新月份 */
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
watch(month, m => { if (m?.status === "open") layer.value = "pre"; }, { immediate: true });
watch(ym, () => { layer.value = month.value?.status === "open" ? "pre" : "sched"; });

const showInactive = ref(false);
const showSettings = ref(false);
const issues = ref<Issue[]>([]);
const focus = ref<CellRef | null>(null);
const grid = ref<InstanceType<typeof SchedGrid> | null>(null);
const side = ref<InstanceType<typeof SidePanel> | null>(null);

const STATUS = { open: "開放預班", scheduling: "排班中", published: "已發布" } as const;
const idx = computed(() => yms.value.indexOf(ym.value));
function step(d: number) {
  const n = yms.value[idx.value + d];
  if (n) ym.value = n;
}

const busy = ref(false);
const confirmForce = ref(false);
async function onStart(force = false) {
  busy.value = true;
  try {
    await startMonth(ym.value, force);
    layer.value = "sched";
    confirmForce.value = false;
    emit("toast", "已開始排班：預班凍結並帶入排班層");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "上個月尚未發布") confirmForce.value = true;
    else emit("toast", msg);
  } finally {
    busy.value = false;
  }
}

function onGoto(c: CellRef) {
  focus.value = c;
  grid.value?.goTo(c);
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-hairline text-xs flex-shrink-0">
      <button class="px-1.5 text-muted hover:text-fg disabled:opacity-30" :disabled="idx <= 0" @click="step(-1)">◀</button>
      <select v-model="ym" class="sched-input font-semibold">
        <option v-for="y in yms" :key="y" :value="y">{{ y.slice(0, 4) }}/{{ y.slice(4) }}</option>
      </select>
      <button class="px-1.5 text-muted hover:text-fg disabled:opacity-30" :disabled="idx >= yms.length - 1" @click="step(1)">▶</button>
      <span v-if="month" class="px-2 py-0.5 rounded-full border"
        :class="month.status === 'open' ? 'border-accent text-accent' : month.status === 'scheduling' ? 'border-warning text-warning' : 'border-success text-success'">
        {{ STATUS[month.status] }}
      </span>

      <div v-if="month && month.status !== 'open'" class="flex border border-hairline rounded overflow-hidden ml-2">
        <button v-for="l in (['sched', 'pre'] as const)" :key="l" class="px-2.5 py-1"
          :class="layer === l ? 'bg-accent text-white' : 'text-muted hover:bg-elevated'" @click="layer = l">
          {{ l === "sched" ? "排班層" : "預班層（凍結）" }}
        </button>
      </div>

      <label class="flex items-center gap-1 text-muted ml-2"><input v-model="showInactive" type="checkbox" />顯示非在職</label>

      <div class="ml-auto flex items-center gap-2">
        <button class="px-2 py-1 text-muted hover:text-fg disabled:opacity-30" :disabled="!grid?.canUndo" title="復原 Ctrl+Z" @click="grid?.undo()">↶ 復原</button>
        <button class="px-2 py-1 text-muted hover:text-fg disabled:opacity-30" :disabled="!grid?.canRedo" title="重做 Ctrl+Y" @click="grid?.redo()">↷ 重做</button>
        <button v-if="isStaff && month" class="px-2.5 py-1 border border-hairline rounded hover:bg-elevated" @click="showSettings = true">本月設定</button>
        <button v-if="isStaff && month?.status === 'open'" class="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-40"
          :disabled="busy" @click="onStart()">開始排班</button>
      </div>
    </div>

    <div v-if="confirmForce" class="flex items-center gap-2 px-3 py-2 bg-warning/10 border-b border-warning/40 text-xs">
      <span class="text-warning">{{ prevYm(ym) }} 尚未發布，配額餘數的交接依據（X）還沒定案。</span>
      <button class="px-2 py-1 border border-warning/60 rounded text-warning hover:bg-warning/10" @click="onStart(true)">強制以目前 X 暫時交接</button>
      <button class="px-2 py-1 text-muted" @click="confirmForce = false">取消</button>
    </div>

    <div v-if="!month" class="flex-1 flex items-center justify-center text-sm text-muted">尚無月份，請到「月份與輪值」新增或從 Excel 匯入</div>
    <div v-else class="flex-1 flex overflow-hidden">
      <div class="flex-1 overflow-hidden">
        <SchedGrid ref="grid" :ym="ym" :layer="layer" :show-inactive="showInactive"
          @toast="m => emit('toast', m)" @issues="v => (issues = v)" @focus="c => (focus = c)"
          @showlog="c => { focus = c; side?.showLog(); }" />
      </div>
      <div class="w-80 flex-shrink-0">
        <SidePanel ref="side" :ym="ym" :issues="issues" :focus="focus" @goto="onGoto" />
      </div>
    </div>

    <MonthSettings v-if="showSettings && month" :ym="ym" @close="showSettings = false" @toast="m => emit('toast', m)" />
  </div>
</template>
