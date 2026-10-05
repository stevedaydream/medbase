<script setup lang="ts">
import { computed, ref } from "vue";
import { useRowDrag, moveById } from "@/composables/useRowDrag";
import {
  useSchedStore, saveGlobal, appendLog, actorName, recompute, schedGroups, groupName,
  addGroup, renameGroup, removeGroup, personInAnyRoster,
} from "@/composables/useSchedStore";
import { newId, type Person, type Role } from "@/shared/sched/types";
import { DEFAULT_GROUP, personGroup } from "@/shared/sched/groups";

/** canEdit：人員主檔與群組全院共用，只有 super 可以修改（ADR-025）；排班者只看自己群組的人 */
const props = defineProps<{ canEdit: boolean }>();
const emit = defineEmits<{ toast: [msg: string] }>();
const store = useSchedStore();
const filter = ref("");

const ROLES: { key: Role; label: string }[] = [
  { key: "employee", label: "員工" },
  { key: "scheduler", label: "排班者" },
  { key: "super", label: "super" },
];

const sorted = computed(() =>
  [...store.people]
    .sort((a, b) => a.order - b.order)
    .filter(p => props.canEdit || personGroup(p) === store.group)
    .filter(p => !filter.value || p.name.includes(filter.value) || p.unit.includes(filter.value) || groupName(personGroup(p)).includes(filter.value)),
);
/** 尚未分組的在職人員（手機看不到班表，也不會出現在月份名單候選） */
const ungrouped = computed(() => store.people.filter(p => p.active && !personGroup(p)));

let timer: ReturnType<typeof setTimeout> | null = null;
const pendingLog: string[] = [];
let pendingRota = false;
/** 存檔並寫操作紀錄；rota＝影響 8-4／春節輪序（順序、免輪、啟用），需往後重算 */
function persist(detail = "", rota = false) {
  if (detail) pendingLog.push(detail);
  pendingRota ||= rota;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    const details = pendingLog.splice(0).join("；");
    const doRota = pendingRota;
    pendingRota = false;
    try {
      await saveGlobal("people");
      if (details) await appendLog("global", "人員名單", details, actorName());
      if (doRota) {
        const r = await recompute(null, `人員名單異動（${details}）`, { allGroups: true });
        if (r.notices) emit("toast", `已重算輪序，覆蓋 ${r.notices} 筆預班並通知`);
      }
    } catch (e) {
      emit("toast", `儲存失敗：${(e as Error).message}`);
    }
  }, 500);
}
const yn = (b: boolean) => (b ? "是" : "否");

function renumber(list: Person[]) {
  list.forEach((p, i) => { p.order = i; });
}

// ── 拖曳排序：按住 ⠿ 拖到目標位置放開（篩選中停用，避免只看部分名單時排錯） ──
const scroller = ref<HTMLElement | null>(null);
const { dragId, dropBefore, dropAtEnd, onGripDown } = useRowDrag({
  scroller,
  enabled: () => !filter.value && props.canEdit,
  onDrop: (id, before) => {
    const all = [...store.people].sort((a, b) => a.order - b.order);
    if (!moveById(all, x => x.id, id, before)) return;
    renumber(all);
    const p = all.find(x => x.id === id)!;
    persist(`${p.name} 順序移到第 ${p.order + 1}`, true);
  },
});

function addPerson() {
  store.people.push({
    id: newId(), name: "新人員", unit: "", group: store.group, ext: "", his: "", role: "employee", code84: "",
    order: store.people.length, exempt84: false, exemptCny: false, active: true,
  });
  persist("新增人員", true);
}

function setGroup(p: Person, g: string) {
  p.group = g;
  persist(`${p.name} 群組：${g ? groupName(g) : "未分組"}`);
}

async function removePerson(p: Person) {
  const used = await personInAnyRoster(p.id);
  if (used) {
    p.active = false;
    emit("toast", `${p.name} 已出現在月份班表，改為停用（不刪除）`);
  } else {
    store.people.splice(store.people.indexOf(p), 1);
    renumber([...store.people].sort((a, b) => a.order - b.order));
  }
  persist(`${used ? "停用" : "刪除"} ${p.name}`, true);
}

// ── 群組管理（super）──────────────────────────────────────────
const showGroups = ref(false);
const newGid = ref(""), newGname = ref("");
async function groupOp(fn: () => Promise<void>, msg: string) {
  try {
    await fn();
    await appendLog("global", "群組", msg, actorName());
    emit("toast", msg);
  } catch (e) {
    emit("toast", (e as Error).message);
  }
}
const onAddGroup = () => groupOp(async () => {
  await addGroup(newGid.value, newGname.value);
  newGid.value = ""; newGname.value = "";
}, `新增群組 ${newGname.value || newGid.value}（班別、配額、規則從 ${groupName(DEFAULT_GROUP)} 複製）`);
const onRename = (id: string, name: string) => groupOp(() => renameGroup(id, name), `群組 ${id} 改名為 ${name}`);
const onRemoveGroup = (id: string) => groupOp(() => removeGroup(id), `刪除群組 ${groupName(id)}`);
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center gap-2 px-4 py-2 border-b border-hairline">
      <span class="text-sm font-semibold text-fg">{{ canEdit ? "全外科 NP 名單" : `${groupName(store.group)} 人員` }}</span>
      <span class="text-xs text-muted">{{ canEdit ? "順序＝8-4 與春節輪序順序（按住 ⠿ 拖曳調整）；每月排班人員從同群組挑選" : "人員名單由 super 維護" }}</span>
      <input v-model="filter" placeholder="篩選姓名／單位"
        class="ml-auto text-xs px-2 py-1 bg-elevated border border-hairline rounded text-fg outline-none focus:border-accent/40 w-40" />
      <template v-if="canEdit">
        <button class="text-xs px-3 py-1 border border-hairline rounded hover:bg-elevated" @click="showGroups = !showGroups">群組管理</button>
        <button class="text-xs px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded" @click="addPerson">＋ 新增</button>
      </template>
    </div>
    <div v-if="canEdit && ungrouped.length" class="px-4 py-1.5 text-xs bg-warning/10 text-warning border-b border-warning/40">
      {{ ungrouped.length }} 位在職人員尚未分組（{{ ungrouped.map(p => p.name).join("、") }}）：手機看不到任何班表，也不能加入月份名單。請確認後設定群組；只參加 8-4／春節輪值的人可維持未分組。
    </div>
    <div v-if="canEdit && showGroups" class="px-4 py-2 border-b border-hairline text-xs space-y-1.5">
      <div class="text-muted">各群組獨立排班、班表互相隔離；人員、國定假日、8-4、春節全院共用。</div>
      <div v-for="g in schedGroups()" :key="g.id" class="flex items-center gap-2">
        <span class="w-16 font-mono text-fg-secondary">{{ g.id }}</span>
        <input :value="g.name" class="sched-input w-32" @change="onRename(g.id, ($event.target as HTMLInputElement).value)" />
        <span class="text-muted">{{ store.people.filter(p => personGroup(p) === g.id).length }} 人</span>
        <span v-if="g.id === DEFAULT_GROUP" class="text-muted">預設群組</span>
        <button v-else class="text-muted hover:text-danger" @click="onRemoveGroup(g.id)">刪除</button>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="newGid" placeholder="代號（英數字，例 8A）" class="sched-input w-36" />
        <input v-model="newGname" placeholder="名稱" class="sched-input w-32" />
        <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" :disabled="!newGid" @click="onAddGroup">＋ 新增群組</button>
      </div>
    </div>
    <div ref="scroller" class="flex-1 overflow-auto" :class="dragId ? 'select-none cursor-grabbing' : ''">
      <fieldset :disabled="!canEdit">
      <table class="text-xs w-full">
        <thead class="sticky top-0 bg-surface text-muted">
          <tr class="text-left">
            <th class="px-2 py-1.5 w-16">順序</th>
            <th class="px-2">姓名</th>
            <th class="px-2">單位</th>
            <th class="px-2">群組</th>
            <th class="px-2" title="特休依到職週年計算">到職日</th>
            <th class="px-2">分機</th>
            <th class="px-2">HIS 帳號</th>
            <th class="px-2">角色</th>
            <th class="px-2">8-4 代號</th>
            <th class="px-2 text-center">8-4 免輪</th>
            <th class="px-2 text-center">春節免輪</th>
            <th class="px-2 text-center">啟用</th>
            <th class="px-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in sorted" :key="p.id" :data-drag-row="p.id" class="border-t"
            :class="[p.active ? '' : 'opacity-50', dropBefore === p.id && dragId !== p.id ? 'border-t-2 border-t-accent' : 'border-hairline',
                     dragId && dropAtEnd && i === sorted.length - 1 ? 'border-b-2 border-b-accent' : '',
                     dragId === p.id ? 'bg-accent/10' : '']">
            <td class="px-2 py-1 whitespace-nowrap text-muted">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded touch-none"
                :class="filter ? 'opacity-30 cursor-not-allowed' : 'cursor-grab hover:bg-elevated hover:text-fg'"
                :title="filter ? '清除篩選後才能拖曳排序' : '按住拖曳調整順序'" @pointerdown="onGripDown($event, p.id)">⠿</span>
              {{ p.order + 1 }}
            </td>
            <td class="px-2"><input v-model="p.name" class="sched-input w-24" @change="persist(`姓名改為 ${p.name}`)" /></td>
            <td class="px-2"><input v-model="p.unit" class="sched-input w-14" @change="persist(`${p.name} 單位：${p.unit}`)" /></td>
            <td class="px-2">
              <select class="sched-input" :class="{ warn: !personGroup(p) && p.active }" :value="personGroup(p)" @change="setGroup(p, ($event.target as HTMLSelectElement).value)">
                <option value="">未分組</option>
                <option v-for="g in schedGroups()" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </td>
            <td class="px-2">
              <input :value="p.hireDate ?? ''" type="date" class="sched-input" :class="{ warn: !p.hireDate && p.active && !!personGroup(p) }"
                @change="p.hireDate = ($event.target as HTMLInputElement).value; persist(`${p.name} 到職日：${p.hireDate || '未填'}`)" />
            </td>
            <td class="px-2"><input v-model="p.ext" class="sched-input w-16" @change="persist(`${p.name} 分機：${p.ext}`)" /></td>
            <td class="px-2">
              <input v-model="p.his" class="sched-input w-24" :class="{ warn: !p.his }" @change="persist(`${p.name} HIS 帳號已修改`)" />
            </td>
            <td class="px-2">
              <select v-model="p.role" class="sched-input" @change="persist(`${p.name} 角色：${p.role}`)">
                <option v-for="r in ROLES" :key="r.key" :value="r.key">{{ r.label }}</option>
              </select>
            </td>
            <td class="px-2"><input v-model="p.code84" class="sched-input w-10" @change="persist(`${p.name} 8-4 代號：${p.code84}`)" /></td>
            <td class="px-2 text-center"><input v-model="p.exempt84" type="checkbox" @change="persist(`${p.name} 8-4 免輪：${yn(p.exempt84)}`, true)" /></td>
            <td class="px-2 text-center"><input v-model="p.exemptCny" type="checkbox" @change="persist(`${p.name} 春節免輪：${yn(p.exemptCny)}`, true)" /></td>
            <td class="px-2 text-center"><input v-model="p.active" type="checkbox" @change="persist(`${p.name} 啟用：${yn(p.active)}`, true)" /></td>
            <td class="px-2 text-right">
              <button v-if="canEdit" class="text-muted hover:text-danger" @click="removePerson(p)">刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
      </fieldset>
      <div v-if="!store.people.length" class="p-6 text-center text-sm text-muted">尚無人員，可從「匯入」頁匯入醫院 Excel</div>
    </div>
  </div>
</template>

