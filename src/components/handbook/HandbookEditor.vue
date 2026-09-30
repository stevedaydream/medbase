<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { loadHandbook, saveHandbookEntry, deleteHandbookEntry, HB_TABLE } from "@/composables/useHandbook";
import { loadEmergencyCards } from "@/composables/useEmergency";
import { onTableSynced } from "@/composables/useTableSync";
import {
  SECTION_LABELS, STATUS_LABELS, ONCALL_BLOCKS, emptyHbSpec, checkHbSpec, searchHandbook,
  type HbEntry, type HbSpec, type HbSection,
} from "@/shared/handbook/types";
import type { EmStatus } from "@/shared/emergency/types";
import { clone } from "@/shared/sched/types";
import { ALL_TOOLS } from "@/shared/tools";
import { PUMP_UNIT_LABELS } from "@/shared/handbook/formulas";

/** 隨身工作手冊編輯器（ADR-018） */
const props = defineProps<{ search: string }>();
const emit = defineEmits<{ count: [n: number]; toast: [kind: "success" | "error", msg: string] }>();

const entries = ref<HbEntry[]>([]);
const emCards = ref<{ uid: string; name: string }[]>([]);
const form = ref<{ uid: string | null; name: string; spec: HbSpec } | null>(null);
const confirmDel = ref(false);

async function reload() {
  entries.value = await loadHandbook();
  emCards.value = (await loadEmergencyCards()).map(c => ({ uid: c.uid, name: c.name }));
  emit("count", entries.value.length);
}
onMounted(reload);
onTableSynced(HB_TABLE, reload);
const list = computed(() => searchHandbook(entries.value, props.search));

function edit(e: HbEntry) { form.value = { uid: e.uid, name: e.name, spec: clone(e.spec) }; confirmDel.value = false; }
function newEntry() { form.value = { uid: null, name: "", spec: emptyHbSpec("oncall") }; confirmDel.value = false; }
defineExpose({ newCard: newEntry });

const errors = computed(() => form.value ? checkHbSpec(form.value.name, form.value.spec) : []);
async function save() {
  const f = form.value;
  if (!f) return;
  if (!f.name.trim()) { emit("toast", "error", "請填名稱"); return; }
  if (f.spec.status !== "draft" && errors.value.length) { emit("toast", "error", `有 ${errors.value.length} 個問題，改好前只能存成草稿`); return; }
  f.uid = await saveHandbookEntry(f);
  await reload();
  emit("toast", "success", "已儲存");
}
async function remove() {
  if (!form.value?.uid) return;
  await deleteHandbookEntry(form.value.uid);
  form.value = null;
  await reload();
  emit("toast", "success", "已刪除");
}

const lines = (a: string[]) => a.join("\n");
const toLines = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);
const keywordsText = computed({
  get: () => form.value?.spec.keywords.join("、") ?? "",
  set: v => { if (form.value) form.value.spec.keywords = v.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean); },
});
function setSection(s: HbSection) {
  const spec = form.value!.spec;
  spec.section = s;
  if (s === "oncall" && !spec.blocks.some(b => b.items.length)) spec.blocks = ONCALL_BLOCKS.map(title => ({ title, items: [] }));
}
function toggleIn(key: "drugs" | "tools", id: string) {
  const s = form.value!.spec;
  s[key] = s[key].includes(id) ? s[key].filter(x => x !== id) : [...s[key], id];
}
const drugEntries = computed(() => entries.value.filter(e => e.spec.section === "drug"));
function toggleEm(uid: string) {
  const s = form.value!.spec;
  s.emergency = s.emergency.includes(uid) ? s.emergency.filter(x => x !== uid) : [...s.emergency, uid];
}
const SECTIONS: HbSection[] = ["oncall", "surgical", "drug", "admin"];
const STATUSES: EmStatus[] = ["draft", "literature", "published"];
</script>

<template>
  <div class="flex-1 flex overflow-hidden">
    <div class="w-60 shrink-0 border-r border-hairline bg-sunken overflow-y-auto">
      <button v-for="e in list" :key="e.uid" @click="edit(e)" class="w-full text-left px-4 py-3 border-b border-hairline text-xs"
        :class="form?.uid === e.uid ? 'bg-accent/10 text-accent font-bold' : 'text-fg-secondary hover:text-fg'">
        <div>{{ e.name }}</div>
        <div class="text-2xs mt-0.5" :class="e.spec.status === 'published' ? 'text-success' : e.spec.status === 'literature' ? 'text-warning' : 'text-muted'">
          {{ SECTION_LABELS[e.spec.section] }} · {{ STATUS_LABELS[e.spec.status] }}
        </div>
      </button>
      <p v-if="!list.length" class="text-center text-muted py-12 text-xs">沒有條目</p>
    </div>

    <div v-if="!form" class="flex-1 flex items-center justify-center text-muted text-sm">選擇左側條目或按「新增」</div>

    <div v-else class="flex-1 overflow-y-auto bg-surface">
      <div class="px-8 py-6 space-y-4 max-w-4xl text-xs">
        <div class="flex items-center gap-2">
          <input v-model="form.name" placeholder="名稱（例：發燒）" class="hb-in flex-1 text-base font-bold" />
          <button @click="save" class="px-4 py-2 rounded-lg bg-accent text-white font-bold">儲存</button>
          <template v-if="form.uid">
            <button v-if="!confirmDel" @click="confirmDel = true" class="px-3 py-2 rounded-lg border border-hairline text-danger">刪除</button>
            <button v-else @click="remove" class="px-3 py-2 rounded-lg bg-danger text-white font-bold">確定刪除？</button>
          </template>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <label class="space-y-1"><span class="text-muted">分區</span>
            <select :value="form.spec.section" @change="setSection(($event.target as HTMLSelectElement).value as HbSection)" class="hb-in w-full">
              <option v-for="s in SECTIONS" :key="s" :value="s">{{ SECTION_LABELS[s] }}</option>
            </select>
          </label>
          <label class="space-y-1"><span class="text-muted">分類</span><input v-model="form.spec.category" class="hb-in w-full" placeholder="例：感染" /></label>
          <label class="space-y-1"><span class="text-muted">狀態</span>
            <select v-model="form.spec.status" class="hb-in w-full"><option v-for="s in STATUSES" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option></select>
          </label>
        </div>
        <label class="block space-y-1"><span class="text-muted">搜尋關鍵字（頓號分隔）</span><input v-model="keywordsText" class="hb-in w-full" /></label>

        <div class="space-y-3">
          <div class="flex justify-between"><b class="text-fg-secondary">段落</b>
            <button @click="form.spec.blocks.push({ title: '', items: [] })" class="text-accent">＋ 新增段落</button></div>
          <div v-for="(b, i) in form.spec.blocks" :key="i" class="p-3 rounded-xl border border-hairline bg-sunken space-y-2">
            <div class="flex gap-2">
              <input v-model="b.title" class="hb-in flex-1 font-bold" placeholder="段落標題" />
              <button @click="form.spec.blocks.splice(i, 1)" class="text-danger px-2">✕</button>
            </div>
            <textarea :value="lines(b.items)" @change="b.items = toLines(($event.target as HTMLTextAreaElement).value)" rows="4" class="hb-in w-full" placeholder="一行一項" />
          </div>
        </div>

        <div v-if="emCards.length" class="space-y-1">
          <b class="text-fg-secondary">相關危急處置卡</b>
          <div class="flex flex-wrap gap-3">
            <label v-for="c in emCards" :key="c.uid" class="flex items-center gap-1">
              <input type="checkbox" :checked="form.spec.emergency.includes(c.uid)" @change="toggleEm(c.uid)" />{{ c.name }}
            </label>
          </div>
        </div>
        <div v-if="form.spec.section === 'oncall' || form.spec.section === 'drug'" class="space-y-2">
          <div v-if="drugEntries.length"><b class="text-fg-secondary">相關藥物速查</b>
            <div class="flex flex-wrap gap-3 mt-1"><label v-for="d in drugEntries" :key="d.uid" class="flex items-center gap-1">
              <input type="checkbox" :checked="form.spec.drugs.includes(d.uid)" @change="toggleIn('drugs', d.uid)" />{{ d.name }}</label></div>
          </div>
          <div><b class="text-fg-secondary">相關計算工具</b>
            <div class="flex flex-wrap gap-3 mt-1"><label v-for="t in ALL_TOOLS" :key="t.id" class="flex items-center gap-1">
              <input type="checkbox" :checked="form.spec.tools.includes(t.id)" @change="toggleIn('tools', t.id)" />{{ t.name }}</label></div>
          </div>
        </div>
        <div v-if="form.spec.section === 'drug'" class="p-3 rounded-xl border border-hairline space-y-2">
          <div class="flex justify-between"><b class="text-fg-secondary">院內泡法（計算工具「泵速換算」可一鍵帶入）</b>
            <button @click="(form.spec.dilutions ??= []).push({ drug: '', amt: 0, vol: 0, unit: 0, note: '' })" class="text-accent">＋</button></div>
          <div v-for="(d, j) in form.spec.dilutions ?? []" :key="j" class="flex gap-2 items-center">
            <input v-model="d.drug" class="hb-in w-40" placeholder="藥名（例：Levophed）" />
            <input v-model.number="d.amt" type="number" step="0.1" class="hb-in w-20" placeholder="總量" /><span class="text-muted">{{ d.unit === 3 ? "U" : "mg" }} ／</span>
            <input v-model.number="d.vol" type="number" class="hb-in w-20" placeholder="體積" /><span class="text-muted">mL</span>
            <select v-model.number="d.unit" class="hb-in"><option v-for="(u, k) in PUMP_UNIT_LABELS" :key="k" :value="k">{{ u }}</option></select>
            <input v-model="d.note" class="hb-in flex-1" placeholder="備註（稀釋液、中心靜脈等）" />
            <button @click="form.spec.dilutions!.splice(j, 1)" class="text-danger px-1">✕</button>
          </div>
        </div>
        <div v-if="form.spec.section === 'oncall'" class="p-3 rounded-xl border border-hairline space-y-3">
          <div class="flex justify-between"><b class="text-fg-secondary">用藥建議（依情境）</b>
            <button @click="(form.spec.therapy ??= []).push({ id: 't' + Date.now(), scenario: '', meds: [], notes: '', refs: [] })" class="text-accent">＋ 新增情境</button></div>
          <div v-for="(t, j) in form.spec.therapy ?? []" :key="t.id" class="p-3 rounded-lg bg-sunken space-y-2">
            <div class="flex gap-2">
              <input v-model="t.scenario" class="hb-in flex-1 font-bold" placeholder="情境（例：疑敗血症、來源不明）" />
              <button @click="form.spec.therapy!.splice(j, 1)" class="text-danger px-2">✕</button>
            </div>
            <div v-for="(m, k) in t.meds" :key="k" class="flex gap-2 items-center">
              <input v-model="m.name" class="hb-in w-56" placeholder="藥名（商品名）" />
              <input v-model="m.dose" class="hb-in flex-1" placeholder="劑量、途徑、頻次" />
              <label class="flex items-center gap-1 text-danger"><input v-model="m.alert" type="checkbox" />高警訊</label>
              <button @click="t.meds.splice(k, 1)" class="text-danger px-1">✕</button>
            </div>
            <button @click="t.meds.push({ name: '', dose: '', alert: false })" class="text-accent">＋ 藥物</button>
            <input v-model="t.notes" class="hb-in w-full" placeholder="注意事項" />
            <div v-if="form.spec.refs.length" class="flex flex-wrap gap-3 items-center">
              <span class="text-muted">依據文獻</span>
              <label v-for="(ref, k) in form.spec.refs" :key="k" class="flex items-center gap-1">
                <input type="checkbox" :checked="t.refs?.includes(k)" @change="t.refs = t.refs?.includes(k) ? t.refs.filter(x => x !== k) : [...(t.refs ?? []), k]" />[{{ k + 1 }}] {{ ref.title.slice(0, 20) }}
              </label>
            </div>
          </div>
        </div>
        <label class="block space-y-1"><span class="text-muted">備註</span><input v-model="form.spec.notes" class="hb-in w-full" /></label>

        <div class="p-4 rounded-xl border border-hairline space-y-2">
          <b class="text-fg-secondary">依據與審核</b>
          <input v-model="form.spec.source" class="hb-in w-full" placeholder="依據（院內規範名稱與版本）" />
          <div class="grid grid-cols-2 gap-2">
            <input v-model="form.spec.reviewer" class="hb-in" placeholder="審核人" />
            <input v-model="form.spec.effective" type="date" class="hb-in" />
          </div>
          <div class="flex justify-between"><span class="text-muted">參考文獻</span><button @click="form.spec.refs.push({ title: '', url: '' })" class="text-accent">＋</button></div>
          <div v-for="(r, j) in form.spec.refs" :key="j" class="flex gap-2">
            <input v-model="r.title" class="hb-in flex-1" placeholder="標題" />
            <input v-model="r.url" class="hb-in flex-1" placeholder="網址" />
            <button @click="form.spec.refs.splice(j, 1)" class="text-danger px-1">✕</button>
          </div>
        </div>

        <div v-if="errors.length" class="p-3 rounded-xl border border-danger/40 bg-danger/5 space-y-1">
          <p v-for="(x, j) in errors" :key="j" class="text-danger">⛔ {{ x }}</p>
          <p class="text-muted">有錯誤時只能存成草稿（草稿不會出現在使用畫面）。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hb-in { padding: 0.4rem 0.6rem; border-radius: 0.5rem; background: var(--color-sunken); border: 1px solid var(--color-hairline); color: var(--color-fg); }
</style>
