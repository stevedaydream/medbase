<script setup lang="ts">
import { computed, ref } from "vue";
import { useSchedStore, saveGlobal, appendLog, actorName, recompute } from "@/composables/useSchedStore";
import { newId, type Person, type Role } from "@/shared/sched/types";

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
    .filter(p => !filter.value || p.name.includes(filter.value) || p.unit.includes(filter.value)),
);

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
        const r = await recompute(null, `人員名單異動（${details}）`);
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

function move(p: Person, delta: number) {
  const all = [...store.people].sort((a, b) => a.order - b.order);
  const i = all.indexOf(p), j = i + delta;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  renumber(all);
  persist(`${p.name} 順序移到第 ${p.order + 1}`, true);
}

function addPerson() {
  store.people.push({
    id: newId(), name: "新人員", unit: "9A", ext: "", his: "", role: "employee", code84: "",
    order: store.people.length, exempt84: false, exemptCny: false, active: true,
  });
  persist("新增人員", true);
}

function removePerson(p: Person) {
  const used = Object.values(store.months).some(m => m.roster.some(r => r.personId === p.id));
  if (used) {
    p.active = false;
    emit("toast", `${p.name} 已出現在月份班表，改為停用（不刪除）`);
  } else {
    store.people.splice(store.people.indexOf(p), 1);
    renumber([...store.people].sort((a, b) => a.order - b.order));
  }
  persist(`${used ? "停用" : "刪除"} ${p.name}`, true);
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center gap-2 px-4 py-2 border-b border-hairline">
      <span class="text-sm font-semibold text-fg">全外科 NP 名單</span>
      <span class="text-xs text-muted">順序＝8-4 與春節輪序順序；每月排班人員從這裡挑選</span>
      <input v-model="filter" placeholder="篩選姓名／單位"
        class="ml-auto text-xs px-2 py-1 bg-elevated border border-hairline rounded text-fg outline-none focus:border-accent/40 w-40" />
      <button class="text-xs px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded" @click="addPerson">＋ 新增</button>
    </div>
    <div class="flex-1 overflow-auto">
      <table class="text-xs w-full">
        <thead class="sticky top-0 bg-surface text-muted">
          <tr class="text-left">
            <th class="px-2 py-1.5 w-16">順序</th>
            <th class="px-2">姓名</th>
            <th class="px-2">單位</th>
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
          <tr v-for="p in sorted" :key="p.id" class="border-t border-hairline" :class="p.active ? '' : 'opacity-50'">
            <td class="px-2 py-1 whitespace-nowrap text-muted">
              <button class="hover:text-fg px-0.5" title="上移" @click="move(p, -1)">▲</button>
              <button class="hover:text-fg px-0.5" title="下移" @click="move(p, 1)">▼</button>
              {{ p.order + 1 }}
            </td>
            <td class="px-2"><input v-model="p.name" class="sched-input w-24" @change="persist(`姓名改為 ${p.name}`)" /></td>
            <td class="px-2"><input v-model="p.unit" class="sched-input w-14" @change="persist(`${p.name} 單位：${p.unit}`)" /></td>
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
              <button class="text-muted hover:text-danger" @click="removePerson(p)">刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!store.people.length" class="p-6 text-center text-sm text-muted">尚無人員，可從「匯入」頁匯入醫院 Excel</div>
    </div>
  </div>
</template>

