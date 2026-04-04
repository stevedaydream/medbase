<script setup lang="ts">
import { ref, computed } from "vue";
import { runProjection, type RotationPool } from "@/utils/rotationEngine";

interface StaffMember { code: string; name: string; role?: string }
interface Shift { code: string; color: string }
interface SessionUser { code: string; name: string; role: string }

const props = defineProps<{
  pools: RotationPool[];
  staff: StaffMember[];
  shifts: Shift[];
  session: SessionUser;
  year: number;
  month: number;
}>();

const emit = defineEmits<{ "update:pools": [pools: RotationPool[]] }>();

const canEdit = computed(() =>
  ["super", "admin", "scheduler"].includes(props.session.role)
);

// ── Pool selection ────────────────────────────────────────────────────
const selectedIdx = ref(0);
const selected = computed(() => props.pools[selectedIdx.value] ?? null);

// ── Helpers ───────────────────────────────────────────────────────────
function getName(code: string) {
  return props.staff.find(s => s.code === code)?.name ?? code;
}

// Next-to-be-picked index in selected pool
const nextPickIdx = computed(() => {
  if (!selected.value || !selected.value.order.length) return -1;
  return (selected.value.lastIndex + 1) % selected.value.order.length;
});

// ── Mutation helpers ──────────────────────────────────────────────────
function updatePool(idx: number, patch: Partial<RotationPool>) {
  const newPools = props.pools.map((p, i) => i === idx ? { ...p, ...patch } : p);
  emit("update:pools", newPools);
}

function setQuota(delta: number) {
  if (!selected.value) return;
  const newQuota = Math.max(1, (selected.value.quota ?? 1) + delta);
  updatePool(selectedIdx.value, { quota: newQuota });
}

function setShiftCode(code: string) {
  if (!canEdit.value) return;
  updatePool(selectedIdx.value, { shiftCode: code });
}

function setStartPoint(memberIdx: number) {
  if (!selected.value || !canEdit.value) return;
  const len = selected.value.order.length;
  const newLast = (memberIdx - 1 + len) % len;
  updatePool(selectedIdx.value, { lastIndex: newLast });
}

function removeMember(memberCode: string) {
  if (!selected.value || !canEdit.value) return;
  const newOrder = selected.value.order.filter(c => c !== memberCode);
  const safeIdx = newOrder.length ? Math.min(selected.value.lastIndex, newOrder.length - 1) : -1;
  updatePool(selectedIdx.value, { order: newOrder, lastIndex: safeIdx });
}

// ── Add member picker ─────────────────────────────────────────────────
const showAddPicker = ref(false);
const availableStaff = computed(() =>
  props.staff.filter(s => !selected.value?.order.includes(s.code))
);
function addMember(code: string) {
  if (!selected.value || !canEdit.value) return;
  updatePool(selectedIdx.value, { order: [...selected.value.order, code] });
  showAddPicker.value = false;
}

// ── Add / remove custom pool ──────────────────────────────────────────
const showNewPool = ref(false);
const newPoolName  = ref("");
const newPoolLabel = ref("");
const newPoolShift = ref("D");
const DEFAULT_POOL_NAMES = ["satD","satN","sunD","sunN","holD","holN","wdOff"];

function addPool() {
  const pn = newPoolName.value.trim();
  const lb = newPoolLabel.value.trim();
  if (!pn || !lb) return;
  if (props.pools.some(p => p.poolName === pn)) return;
  const newPool: RotationPool = {
    poolName: pn, label: lb, shiftCode: newPoolShift.value,
    quota: 1, order: [], lastIndex: -1, skipQueue: [],
  };
  emit("update:pools", [...props.pools, newPool]);
  selectedIdx.value = props.pools.length; // select new pool
  newPoolName.value = "";
  newPoolLabel.value = "";
  showNewPool.value = false;
}

function removePool(idx: number) {
  if (!confirm(`確定刪除「${props.pools[idx].label}」輪序池？`)) return;
  const newPools = props.pools.filter((_, i) => i !== idx);
  emit("update:pools", newPools);
  selectedIdx.value = Math.min(selectedIdx.value, newPools.length - 1);
}

// ── Drag reorder members ──────────────────────────────────────────────
const dragFromIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

function onDragStart(idx: number) { dragFromIdx.value = idx; }
function onDragOver(e: DragEvent, idx: number) {
  e.preventDefault();
  dragOverIdx.value = idx;
}
function onDrop(_e: DragEvent, targetIdx: number) {
  if (dragFromIdx.value === null || dragFromIdx.value === targetIdx) {
    dragFromIdx.value = null; dragOverIdx.value = null; return;
  }
  const order = [...selected.value!.order];
  const [moved] = order.splice(dragFromIdx.value, 1);
  order.splice(targetIdx, 0, moved);
  dragFromIdx.value = null; dragOverIdx.value = null;
  updatePool(selectedIdx.value, { order });
}
function onDragEnd() { dragFromIdx.value = null; dragOverIdx.value = null; }

// ── Projection preview ────────────────────────────────────────────────
const prevYear  = ref(props.year);
const prevMonth = ref(props.month);

function prevPrevMonth() {
  if (prevMonth.value === 1) { prevYear.value--; prevMonth.value = 12; }
  else prevMonth.value--;
}
function nextPrevMonth() {
  if (prevMonth.value === 12) { prevYear.value++; prevMonth.value = 1; }
  else prevMonth.value++;
}

const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];

const projectionRows = computed(() => {
  const projection = runProjection(props.pools, prevYear.value, prevMonth.value);
  const daysInMonth = new Date(prevYear.value, prevMonth.value, 0).getDate();
  const rows: Array<{
    day: number;
    dateStr: string;
    dow: number;
    entries: Array<{ pool: RotationPool; codes: string[] }>;
  }> = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(prevYear.value, prevMonth.value - 1, day).getDay();
    const entries: Array<{ pool: RotationPool; codes: string[] }> = [];
    for (const pool of props.pools) {
      const key = `${day}-${pool.poolName}`;
      const assigned = projection.get(key);
      if (assigned?.length) {
        entries.push({ pool, codes: assigned.map(a => a.code) });
      }
    }
    if (entries.length) {
      const mm = String(prevMonth.value).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      rows.push({ day, dateStr: `${mm}/${dd}`, dow, entries });
    }
  }
  return rows;
});

const shiftCodes = computed(() => props.shifts.map(s => s.code));
</script>

<template>
  <div class="flex h-full overflow-hidden">

    <!-- ── Left: Pool list ────────────────────────────────────────── -->
    <div class="w-44 border-r border-gray-800 flex flex-col flex-shrink-0 bg-gray-900">
      <div class="px-3 py-2.5 border-b border-gray-800">
        <p class="text-xs font-semibold text-gray-400">輪序池</p>
      </div>
      <div class="flex-1 overflow-y-auto py-1">
        <button
          v-for="(pool, idx) in pools" :key="pool.poolName"
          @click="selectedIdx = idx"
          class="w-full text-left px-3 py-2 text-xs transition-colors"
          :class="selectedIdx === idx
            ? 'bg-blue-900/50 text-white border-r-2 border-blue-500'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'"
        >
          <div class="font-medium">{{ pool.label }}</div>
          <div class="text-gray-600 font-mono mt-0.5">{{ pool.poolName }}
            <span v-if="pool.order.length" class="text-gray-700">・{{ pool.order.length }}人</span>
          </div>
        </button>
      </div>
      <!-- Add pool -->
      <div class="border-t border-gray-800 p-2">
        <button v-if="!showNewPool && canEdit"
          @click="showNewPool = true"
          class="w-full text-xs py-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors">
          + 新增自訂池
        </button>
        <div v-if="showNewPool" class="space-y-1.5">
          <input v-model="newPoolLabel" placeholder="名稱（週六白班）"
            class="w-full text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-blue-500" />
          <input v-model="newPoolName" placeholder="ID（如 satD2）" maxlength="10"
            class="w-full text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-blue-500" />
          <div class="flex gap-1">
            <button @click="addPool" class="flex-1 text-xs py-1 bg-blue-700 hover:bg-blue-600 text-white rounded">新增</button>
            <button @click="showNewPool = false" class="text-xs px-2 text-gray-600 hover:text-gray-400">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Right area ─────────────────────────────────────────────── -->
    <div class="flex-1 overflow-hidden flex flex-col">

      <!-- No pool selected -->
      <div v-if="!selected" class="flex-1 flex items-center justify-center text-gray-700 text-sm">
        請選擇左側輪序池
      </div>

      <template v-else>
      <!-- Top: Pool settings + members -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4 border-b border-gray-800">

        <!-- Pool header row -->
        <div class="flex items-center gap-3 flex-wrap">
          <h3 class="text-sm font-semibold text-white">{{ selected.label }}</h3>
          <span class="text-xs text-gray-600 font-mono">{{ selected.poolName }}</span>

          <!-- Shift code selector -->
          <div class="flex items-center gap-1.5 ml-2">
            <span class="text-xs text-gray-500">班別</span>
            <select :value="selected.shiftCode" @change="setShiftCode(($event.target as HTMLSelectElement).value)"
              :disabled="!canEdit"
              class="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 outline-none focus:border-gray-500 disabled:opacity-60">
              <option v-for="sc in shiftCodes" :key="sc" :value="sc">{{ sc }}</option>
            </select>
          </div>

          <!-- Quota spinner -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-gray-500">每日人數</span>
            <div class="flex items-center border border-gray-700 rounded overflow-hidden">
              <button @click="setQuota(-1)" :disabled="!canEdit || selected.quota <= 1"
                class="px-1.5 py-0.5 text-gray-400 hover:bg-gray-700 disabled:opacity-30 text-xs">−</button>
              <span class="px-2 text-xs text-white font-mono min-w-[1.5rem] text-center">{{ selected.quota }}</span>
              <button @click="setQuota(1)" :disabled="!canEdit"
                class="px-1.5 py-0.5 text-gray-400 hover:bg-gray-700 disabled:opacity-30 text-xs">＋</button>
            </div>
          </div>

          <!-- Delete pool (custom only) -->
          <button v-if="canEdit && !DEFAULT_POOL_NAMES.includes(selected.poolName)"
            @click="removePool(selectedIdx)"
            class="ml-auto text-xs text-red-700 hover:text-red-500 transition-colors">
            刪除此池
          </button>
        </div>

        <!-- Members -->
        <div>
          <p class="text-xs text-gray-500 mb-2">
            成員順序
            <span class="text-gray-700 ml-1">（拖拽調整；▶ = 下次輪到）</span>
          </p>

          <div class="flex flex-wrap gap-2 min-h-[2.5rem]">
            <div
              v-for="(code, mi) in selected.order" :key="code"
              draggable="true"
              @dragstart="onDragStart(mi)"
              @dragover="onDragOver($event, mi)"
              @drop="onDrop($event, mi)"
              @dragend="onDragEnd"
              class="group flex items-center gap-1 px-2 py-1 rounded-lg border text-xs cursor-grab transition-colors select-none"
              :class="[
                dragOverIdx === mi && dragFromIdx !== mi
                  ? 'border-blue-500 bg-blue-900/40'
                  : mi === nextPickIdx
                    ? 'border-blue-400 bg-blue-950/60 text-blue-200'
                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
              ]"
            >
              <!-- Next pointer -->
              <span v-if="mi === nextPickIdx" class="text-blue-400 text-xs leading-none">▶</span>
              <span class="font-mono text-gray-500 text-xs">{{ code }}</span>
              <span>{{ getName(code) }}</span>

              <!-- Hover actions -->
              <span class="hidden group-hover:flex items-center gap-0.5 ml-0.5">
                <button v-if="canEdit"
                  @click.stop="setStartPoint(mi)"
                  title="設為輪序起點"
                  class="text-gray-600 hover:text-blue-400 text-xs px-0.5">▷</button>
                <button v-if="canEdit"
                  @click.stop="removeMember(code)"
                  class="text-gray-700 hover:text-red-500 text-xs px-0.5">✕</button>
              </span>
            </div>

            <!-- Empty state -->
            <div v-if="!selected.order.length" class="text-xs text-gray-700 self-center">
              尚無成員，點「+ 加入成員」開始
            </div>

            <!-- Add member button -->
            <div v-if="canEdit" class="relative">
              <button @click="showAddPicker = !showAddPicker"
                class="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-gray-700 text-xs text-gray-600 hover:border-gray-500 hover:text-gray-400 transition-colors">
                + 加入
              </button>
              <!-- Picker dropdown -->
              <div v-if="showAddPicker"
                class="absolute top-8 left-0 z-20 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-1 min-w-[10rem] max-h-48 overflow-y-auto">
                <div v-if="!availableStaff.length" class="text-xs text-gray-600 px-2 py-1">全員已加入</div>
                <button v-for="s in availableStaff" :key="s.code"
                  @click="addMember(s.code)"
                  class="w-full text-left text-xs px-2 py-1.5 hover:bg-gray-800 rounded text-gray-300 transition-colors">
                  <span class="font-mono text-gray-500 mr-1.5">{{ s.code }}</span>{{ s.name }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom: Projection preview -->
      <div class="flex-1 overflow-hidden flex flex-col min-h-0">
        <!-- Preview header -->
        <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-800 flex-shrink-0">
          <span class="text-xs text-gray-500 font-semibold">投影預覽</span>
          <div class="flex items-center gap-1 ml-2">
            <button @click="prevPrevMonth" class="px-1.5 text-gray-500 hover:text-white text-sm">‹</button>
            <span class="text-xs font-mono text-gray-300 w-16 text-center">
              {{ prevYear }}/{{ String(prevMonth).padStart(2,'0') }}
            </span>
            <button @click="nextPrevMonth" class="px-1.5 text-gray-500 hover:text-white text-sm">›</button>
          </div>
          <span class="text-xs text-gray-700 ml-2">（唯讀，僅顯示有指派的日期）</span>
        </div>

        <!-- Preview table -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="!projectionRows.length"
            class="flex items-center justify-center h-full text-gray-700 text-xs">
            無投影資料（輪序池尚無成員）
          </div>
          <table v-else class="w-full text-xs border-collapse">
            <thead class="sticky top-0 bg-gray-900 z-10">
              <tr class="text-gray-600 border-b border-gray-800">
                <th class="px-3 py-1.5 text-left font-medium">日期</th>
                <th class="px-2 py-1.5 text-center font-medium w-8">週</th>
                <th class="px-3 py-1.5 text-left font-medium">池</th>
                <th class="px-3 py-1.5 text-left font-medium">指派</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in projectionRows" :key="row.day">
                <tr v-for="(entry, ei) in row.entries" :key="ei"
                  class="border-b border-gray-800/50 hover:bg-gray-900/40"
                  :class="row.dow === 6 ? 'bg-blue-950/10' : row.dow === 0 ? 'bg-red-950/10' : ''">
                  <td class="px-3 py-1.5">
                    <span v-if="ei === 0"
                      :class="row.dow === 6 ? 'text-blue-300' : row.dow === 0 ? 'text-red-300' : 'text-gray-300'"
                    >{{ row.dateStr }}</span>
                  </td>
                  <td class="px-2 py-1.5 text-center"
                    :class="row.dow === 6 ? 'text-blue-400' : row.dow === 0 ? 'text-red-400' : 'text-gray-600'">
                    <span v-if="ei === 0">{{ DOW_ZH[row.dow] }}</span>
                  </td>
                  <td class="px-3 py-1.5 text-gray-500">
                    <span class="font-mono">{{ entry.pool.poolName }}</span>
                    <span v-if="entry.pool.quota > 1" class="text-gray-700">×{{ entry.pool.quota }}</span>
                  </td>
                  <td class="px-3 py-1.5">
                    <span v-for="code in entry.codes" :key="code"
                      class="inline-block mr-2 text-gray-300">
                      <span class="font-mono text-gray-600 text-xs mr-0.5">{{ code }}</span>{{ getName(code) }}
                    </span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      </template>

    </div><!-- end right area -->
  </div>
</template>
