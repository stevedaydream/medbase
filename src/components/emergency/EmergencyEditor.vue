<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { loadEmergencyCards, saveEmergencyCard, deleteEmergencyCard, EM_TABLE } from "@/composables/useEmergency";
import { onTableSynced } from "@/composables/useTableSync";
import { checkSpec, searchCards, tierRangeText, measureFormula } from "@/shared/emergency/logic";
import {
  EM_CATEGORIES, STATUS_LABELS, emptySpec, newEmId, type EmCard, type EmSpec, type EmTier, type EmStatus,
} from "@/shared/emergency/types";
import { clone } from "@/shared/sched/types";
import { FORMULAS } from "@/shared/handbook/formulas";

/** 危急處置卡編輯器（ADR-017）：分級卡的級距表、是非題、依據與狀態 */
const props = defineProps<{ search: string }>();
const emit = defineEmits<{ count: [n: number]; toast: [kind: "success" | "error", msg: string] }>();

const cards = ref<EmCard[]>([]);
const form = ref<{ uid: string | null; name: string; spec: EmSpec } | null>(null);
const confirmDel = ref(false);

async function reload() {
  cards.value = await loadEmergencyCards();
  emit("count", cards.value.length);
}
onMounted(reload);
onTableSynced(EM_TABLE, reload);
const list = computed(() => searchCards(cards.value, props.search));

function edit(c: EmCard) { form.value = { uid: c.uid, name: c.name, spec: clone(c.spec) }; confirmDel.value = false; }
function newCard() { form.value = { uid: null, name: "", spec: emptySpec("graded") }; confirmDel.value = false; }
defineExpose({ newCard });

const issues = computed(() => form.value ? checkSpec(form.value.name, form.value.spec) : []);
const errors = computed(() => issues.value.filter(i => i.level === "error"));

async function save() {
  const f = form.value;
  if (!f) return;
  if (!f.name.trim()) { emit("toast", "error", "請填名稱"); return; }
  if (f.spec.status !== "draft" && errors.value.length) { emit("toast", "error", `有 ${errors.value.length} 個問題，改好前只能存成草稿`); return; }
  f.uid = await saveEmergencyCard(f);
  await reload();
  emit("toast", "success", "已儲存");
}
async function remove() {
  if (!form.value?.uid) return;
  await deleteEmergencyCard(form.value.uid);
  form.value = null;
  await reload();
  emit("toast", "success", "已刪除");
}

// ── 欄位輔助 ──────────────────────────────────────────────────
/** 多行文字 ↔ 陣列 */
const lines = (a: string[]) => a.join("\n");
const toLines = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);
const num = (s: string) => (s.trim() === "" ? null : Number(s));
const keywordsText = computed({
  get: () => form.value?.spec.keywords.join("、") ?? "",
  set: v => { if (form.value) form.value.spec.keywords = v.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean); },
});
function setKind(k: EmSpec["kind"]) {
  const s = form.value!.spec;
  s.kind = k;
  if (k === "graded" && !s.measure) s.measure = { label: "", unit: "", step: 1 };
}
function addTier() {
  form.value!.spec.tiers.push({ id: newEmId(), min: null, max: null, when: {}, title: "", actions: [], meds: [], rechecks: [], notes: "" });
}
function whenOf(t: EmTier, id: string): string { return t.when[id] === undefined ? "" : t.when[id] ? "yes" : "no"; }
function setWhen(t: EmTier, id: string, v: string) {
  const w = { ...t.when };
  if (v === "") delete w[id]; else w[id] = v === "yes";
  t.when = w;
}
function removeCondition(i: number) {
  const s = form.value!.spec;
  const id = s.conditions[i].id;
  s.conditions.splice(i, 1);
  for (const t of s.tiers) { const w = { ...t.when }; delete w[id]; t.when = w; }
}
const STATUSES: EmStatus[] = ["draft", "literature", "published"];
function toggleRef(t: EmTier, k: number) {
  const cur = new Set(t.refs ?? []);
  if (cur.has(k)) cur.delete(k); else cur.add(k);
  t.refs = [...cur].sort((a, b) => a - b);
}
/** 刪除文獻時同步調整各級距的索引 */
function removeRef(j: number) {
  const s = form.value!.spec;
  s.refs.splice(j, 1);
  for (const t of s.tiers) if (t.refs) t.refs = t.refs.filter(k => k !== j).map(k => (k > j ? k - 1 : k));
}
</script>

<template>
  <div class="flex-1 flex overflow-hidden">
    <!-- 清單 -->
    <div class="w-60 shrink-0 border-r border-hairline bg-sunken overflow-y-auto">
      <button v-for="c in list" :key="c.uid" @click="edit(c)"
        class="w-full text-left px-4 py-3 border-b border-hairline text-xs"
        :class="form?.uid === c.uid ? 'bg-danger/10 text-danger font-bold' : 'text-fg-secondary hover:text-fg'">
        <div>{{ c.name }}</div>
        <div class="text-2xs mt-0.5" :class="c.spec.status === 'published' ? 'text-success' : c.spec.status === 'literature' ? 'text-warning' : 'text-muted'">
          {{ c.spec.category }} · {{ STATUS_LABELS[c.spec.status] }}
        </div>
      </button>
      <p v-if="!list.length" class="text-center text-muted py-12 text-xs">沒有卡片</p>
    </div>

    <div v-if="!form" class="flex-1 flex items-center justify-center text-muted text-sm">選擇左側卡片或按「新增」</div>

    <!-- 編輯 -->
    <div v-else class="flex-1 overflow-y-auto bg-surface">
      <div class="px-8 py-6 space-y-5 max-w-4xl text-xs">
        <div class="flex items-center gap-2">
          <input v-model="form.name" placeholder="名稱（例：鉀離子高）" class="em-in flex-1 text-base font-bold" />
          <button @click="save" class="px-4 py-2 rounded-lg bg-accent text-white font-bold">儲存</button>
          <template v-if="form.uid">
            <button v-if="!confirmDel" @click="confirmDel = true" class="px-3 py-2 rounded-lg border border-hairline text-danger">刪除</button>
            <button v-else @click="remove" class="px-3 py-2 rounded-lg bg-danger text-white font-bold">確定刪除？</button>
          </template>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <label class="space-y-1"><span class="text-muted">類型</span>
            <select :value="form.spec.kind" @change="setKind(($event.target as HTMLSelectElement).value as EmSpec['kind'])" class="em-in w-full">
              <option value="graded">分級卡（輸入數值）</option>
              <option value="general">一般卡（清單）</option>
            </select>
          </label>
          <label class="space-y-1"><span class="text-muted">分類</span>
            <select v-model="form.spec.category" class="em-in w-full"><option v-for="c in EM_CATEGORIES" :key="c">{{ c }}</option></select>
          </label>
          <label class="space-y-1"><span class="text-muted">狀態</span>
            <select v-model="form.spec.status" class="em-in w-full"><option v-for="s in STATUSES" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option></select>
          </label>
        </div>
        <label class="block space-y-1"><span class="text-muted">搜尋關鍵字（症狀、別名，用頓號分隔）</span>
          <input v-model="keywordsText" class="em-in w-full" placeholder="例：喘、SpO2、呼吸窘迫" />
        </label>

        <!-- 數值與是非題 -->
        <template v-if="form.spec.kind === 'graded' && form.spec.measure">
          <div class="grid grid-cols-3 gap-3">
            <label class="space-y-1"><span class="text-muted">數值名稱</span><input v-model="form.spec.measure.label" class="em-in w-full" placeholder="血糖" /></label>
            <label class="space-y-1"><span class="text-muted">單位</span><input v-model="form.spec.measure.unit" class="em-in w-full" placeholder="mg/dL" /></label>
            <label class="space-y-1"><span class="text-muted">最小間隔（檢查空隙用）</span><input v-model.number="form.spec.measure.step" type="number" step="0.1" class="em-in w-full" /></label>
          </div>
          <label class="block space-y-1"><span class="text-muted">數值來源</span>
            <select :value="form.spec.measure.formula ?? ''" @change="form.spec.measure.formula = ($event.target as HTMLSelectElement).value || undefined" class="em-in w-full">
              <option value="">直接輸入數值</option>
              <option v-for="f in FORMULAS" :key="f.id" :value="f.id">用公式計算：{{ f.name }}（{{ f.inputs.map(i => i.label).join("、") }}）</option>
            </select>
          </label>
          <div class="space-y-2">
            <div class="flex items-center justify-between"><b class="text-fg-secondary">是非題</b>
              <button @click="form.spec.conditions.push({ id: newEmId(), question: '' })" class="text-accent">＋ 新增</button></div>
            <div v-for="(c, i) in form.spec.conditions" :key="c.id" class="flex gap-2">
              <input v-model="c.question" class="em-in flex-1" placeholder="例：ECG 有高血鉀變化？" />
              <button @click="removeCondition(i)" class="text-danger px-2">✕</button>
            </div>
          </div>

          <!-- 級距 -->
          <div class="space-y-3">
            <div class="flex items-center justify-between"><b class="text-fg-secondary">級距（{{ form.spec.tiers.length }}）</b>
              <button @click="addTier" class="text-accent">＋ 新增級距</button></div>
            <div v-for="(t, i) in form.spec.tiers" :key="t.id" class="p-4 rounded-xl border border-hairline bg-sunken space-y-2">
              <div class="flex gap-2 items-center">
                <input v-model="t.title" class="em-in flex-1 font-bold" placeholder="級距名稱（例：重度）" />
                <input :value="t.min ?? ''" @input="t.min = num(($event.target as HTMLInputElement).value)" class="em-in w-20" placeholder="下限" />
                <span>–</span>
                <input :value="t.max ?? ''" @input="t.max = num(($event.target as HTMLInputElement).value)" class="em-in w-20" placeholder="上限" />
                <select v-if="measureFormula(form.spec)" :value="t.on ?? ''" @change="t.on = ($event.target as HTMLSelectElement).value || undefined" class="em-in" title="比對哪個數值">
                  <option value="">{{ form.spec.measure.label || "主要數值" }}</option>
                  <option v-for="i in measureFormula(form.spec)!.inputs.filter(x => !x.options)" :key="i.key" :value="i.key">{{ i.label }}</option>
                </select>
                <select :value="t.level ?? 'watch'" @change="t.level = ($event.target as HTMLSelectElement).value as EmTier['level']" class="em-in" title="程度">
                  <option value="normal">正常</option><option value="watch">注意</option><option value="urgent">緊急</option>
                </select>
                <span class="text-muted w-40">{{ tierRangeText(form.spec, t) }}</span>
                <button @click="form.spec.tiers.splice(i, 1)" class="text-danger px-2">✕</button>
              </div>
              <div v-if="form.spec.conditions.length" class="flex flex-wrap gap-3">
                <label v-for="c in form.spec.conditions" :key="c.id" class="flex items-center gap-1">
                  <span class="text-muted">{{ c.question || "（未填）" }}</span>
                  <select :value="whenOf(t, c.id)" @change="setWhen(t, c.id, ($event.target as HTMLSelectElement).value)" class="em-in">
                    <option value="">不限</option><option value="yes">是</option><option value="no">否</option>
                  </select>
                </label>
              </div>
              <label class="block space-y-1"><span class="text-muted">處置（一行一步）</span>
                <textarea :value="lines(t.actions)" @change="t.actions = toLines(($event.target as HTMLTextAreaElement).value)" rows="4" class="em-in w-full" />
              </label>
              <div class="space-y-1">
                <div class="flex justify-between"><span class="text-muted">藥物</span><button @click="t.meds.push({ name: '', dose: '', alert: false })" class="text-accent">＋</button></div>
                <div v-for="(m, j) in t.meds" :key="j" class="flex gap-2 items-center">
                  <input v-model="m.name" class="em-in w-48" placeholder="藥名" />
                  <input v-model="m.dose" class="em-in flex-1" placeholder="劑量、途徑、速度" />
                  <label class="flex items-center gap-1 text-danger"><input v-model="m.alert" type="checkbox" />高警訊</label>
                  <button @click="t.meds.splice(j, 1)" class="text-danger px-1">✕</button>
                </div>
              </div>
              <div class="space-y-1">
                <div class="flex justify-between"><span class="text-muted">追蹤提醒</span><button @click="t.rechecks.push({ label: '', minutes: 15 })" class="text-accent">＋</button></div>
                <div v-for="(r, j) in t.rechecks" :key="j" class="flex gap-2 items-center">
                  <input v-model="r.label" class="em-in flex-1" placeholder="例：重測血糖" />
                  <input v-model.number="r.minutes" type="number" min="1" class="em-in w-20" /><span class="text-muted">分鐘</span>
                  <button @click="t.rechecks.splice(j, 1)" class="text-danger px-1">✕</button>
                </div>
              </div>
              <input v-model="t.notes" class="em-in w-full" placeholder="注意事項（選填）" />
              <div v-if="form.spec.refs.length" class="flex flex-wrap gap-3 items-center">
                <span class="text-muted">依據文獻（不勾＝全部）</span>
                <label v-for="(r, k) in form.spec.refs" :key="k" class="flex items-center gap-1">
                  <input type="checkbox" :checked="t.refs?.includes(k)" @change="toggleRef(t, k)" />[{{ k + 1 }}] {{ r.title.slice(0, 24) || "（未填）" }}
                </label>
              </div>
            </div>
          </div>
        </template>

        <!-- 一般卡 -->
        <template v-else>
          <label class="block space-y-1"><span class="text-muted">處置（一行一步）</span>
            <textarea :value="lines(form.spec.general.actions)" @change="form.spec.general.actions = toLines(($event.target as HTMLTextAreaElement).value)" rows="6" class="em-in w-full" />
          </label>
          <div class="space-y-1">
            <div class="flex justify-between"><span class="text-muted">藥物</span><button @click="form.spec.general.meds.push({ name: '', dose: '', alert: false })" class="text-accent">＋</button></div>
            <div v-for="(m, j) in form.spec.general.meds" :key="j" class="flex gap-2 items-center">
              <input v-model="m.name" class="em-in w-48" placeholder="藥名" />
              <input v-model="m.dose" class="em-in flex-1" placeholder="劑量、途徑、速度" />
              <label class="flex items-center gap-1 text-danger"><input v-model="m.alert" type="checkbox" />高警訊</label>
              <button @click="form.spec.general.meds.splice(j, 1)" class="text-danger px-1">✕</button>
            </div>
          </div>
          <div class="space-y-1">
            <div class="flex justify-between"><span class="text-muted">追蹤提醒</span><button @click="form.spec.general.rechecks.push({ label: '', minutes: 5 })" class="text-accent">＋</button></div>
            <div v-for="(r, j) in form.spec.general.rechecks" :key="j" class="flex gap-2 items-center">
              <input v-model="r.label" class="em-in flex-1" />
              <input v-model.number="r.minutes" type="number" min="1" class="em-in w-20" /><span class="text-muted">分鐘</span>
              <button @click="form.spec.general.rechecks.splice(j, 1)" class="text-danger px-1">✕</button>
            </div>
          </div>
        </template>

        <!-- 聯絡、依據 -->
        <div class="space-y-1">
          <div class="flex justify-between"><b class="text-fg-secondary">聯絡對象</b><button @click="form.spec.contacts.push({ label: '', ext: '' })" class="text-accent">＋</button></div>
          <div v-for="(c, j) in form.spec.contacts" :key="j" class="flex gap-2">
            <input v-model="c.label" class="em-in flex-1" placeholder="例：急救小組" />
            <input v-model="c.ext" class="em-in w-32" placeholder="分機" />
            <button @click="form.spec.contacts.splice(j, 1)" class="text-danger px-1">✕</button>
          </div>
        </div>
        <label class="block space-y-1"><span class="text-muted">備註</span><input v-model="form.spec.notes" class="em-in w-full" /></label>

        <div class="p-4 rounded-xl border border-hairline space-y-2">
          <b class="text-fg-secondary">依據與審核</b>
          <input v-model="form.spec.source" class="em-in w-full" placeholder="依據（院內規範名稱與版本）" />
          <div class="grid grid-cols-2 gap-2">
            <input v-model="form.spec.reviewer" class="em-in" placeholder="審核人" />
            <input v-model="form.spec.effective" type="date" class="em-in" />
          </div>
          <div class="flex justify-between"><span class="text-muted">參考文獻</span><button @click="form.spec.refs.push({ title: '', url: '' })" class="text-accent">＋</button></div>
          <div v-for="(r, j) in form.spec.refs" :key="j" class="flex gap-2">
            <input v-model="r.title" class="em-in flex-1" placeholder="標題" />
            <input v-model="r.url" class="em-in flex-1" placeholder="網址" />
            <button @click="removeRef(j)" class="text-danger px-1">✕</button>
          </div>
        </div>

        <div v-if="issues.length" class="p-3 rounded-xl border space-y-1" :class="errors.length ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'">
          <p v-for="(x, j) in issues" :key="j" :class="x.level === 'error' ? 'text-danger' : 'text-warning'">{{ x.level === "error" ? "⛔" : "⚠" }} {{ x.message }}</p>
          <p v-if="errors.length" class="text-muted">有錯誤時只能存成草稿（草稿不會出現在使用畫面）。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.em-in { padding: 0.4rem 0.6rem; border-radius: 0.5rem; background: var(--color-sunken); border: 1px solid var(--color-hairline); color: var(--color-fg); }
</style>
