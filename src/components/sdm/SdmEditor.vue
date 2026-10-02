<script setup lang="ts">
import { ref, computed } from "vue";
import {
  SDM_METHODS, SDM_CONSENTS, SDM_INTENTS, emptySdmSpec, emptyDecision, checkSdm, parseSdmSpec,
  type SdmEntry, type SdmField,
} from "@/shared/sdm/types";

/** SDM 範本編輯（新增或修改）；存檔需填修改人姓名，由呼叫端記在這台電腦 */
const props = defineProps<{ entry: SdmEntry | null; depts: string[]; editor: string }>();
const emit = defineEmits<{
  close: [];
  save: [v: { name: string; spec: SdmEntry["spec"]; editor: string }];
}>();

const name = ref(props.entry?.name ?? "");
const spec = ref(props.entry ? parseSdmSpec(JSON.stringify(props.entry.spec)) : emptySdmSpec());
const keywords = ref(spec.value.keywords.join("、"));
const editor = ref(props.editor);
const errors = ref<string[]>([]);

const CONSENT_ROWS = [
  { key: "surgery", label: "手術" },
  { key: "exam", label: "檢查" },
  { key: "trach", label: "氣切" },
  { key: "intubation", label: "插管" },
] as const;

function toggleMethod(m: string) {
  const s = spec.value;
  s.methods = s.methods.includes(m) ? s.methods.filter(x => x !== m) : [...s.methods, m];
}
const addField = (list: SdmField[]) => list.push({ label: "", value: "" });
function addDecision() { spec.value.decisions.push(emptyDecision()); }
function removeDecision(i: number) { if (spec.value.decisions.length > 1) spec.value.decisions.splice(i, 1); }

const canSave = computed(() => !!name.value.trim() && !!editor.value.trim());
function save() {
  spec.value.keywords = keywords.value.split(/[、,，\s]+/);
  errors.value = checkSdm(name.value, spec.value);
  if (!editor.value.trim()) errors.value.push("請填寫你的姓名（記錄最後修改人）");
  if (errors.value.length) return;
  emit("save", { name: name.value.trim(), spec: spec.value, editor: editor.value.trim() });
}

const input = "w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 font-bold";
const area = "w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 resize-y font-medium leading-relaxed";
const lbl = "text-muted text-xs font-black block mb-1.5";
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm" @click.self="emit('close')">
      <div class="w-full max-w-3xl bg-surface border border-hairline rounded-2xl shadow-2xl flex flex-col max-h-[92vh] text-fg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0 bg-sunken">
          <h3 class="text-xs font-black text-fg">{{ entry ? "編輯 SDM 範本" : "新增 SDM 範本" }}</h3>
          <button @click="emit('close')" class="text-muted hover:text-fg text-xl leading-none cursor-pointer">×</button>
        </div>

        <div class="overflow-y-auto px-6 py-5 space-y-5 flex-1">
          <!-- 基本資料 -->
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2">
              <label :class="lbl">範本名稱 <span class="text-danger">*</span></label>
              <input v-model="name" :class="input" placeholder="如：肱骨幹骨折治療選擇" />
            </div>
            <div>
              <label :class="lbl">科別</label>
              <input v-model="spec.dept" list="sdm-depts" :class="input" placeholder="如：骨科" />
              <datalist id="sdm-depts"><option v-for="d in depts" :key="d" :value="d" /></datalist>
            </div>
          </div>
          <div>
            <label :class="lbl">搜尋關鍵字（以頓號或空白分隔）</label>
            <input v-model="keywords" :class="input" placeholder="如：ORIF、骨折、石膏" />
          </div>

          <!-- 表頭 -->
          <section class="space-y-3">
            <p class="text-xs font-black text-accent">表頭</p>
            <div>
              <label :class="lbl">住院／門診主要目的（HIS 下拉要選的項目）</label>
              <input v-model="spec.purpose" :class="input" placeholder="如：01：開放式復位內固定手術治療選擇" />
            </div>
            <div>
              <label :class="lbl">主要目的補充（下拉下方那一行）</label>
              <input v-model="spec.purposeNote" :class="input" />
            </div>
          </section>

          <!-- 共同欄位 -->
          <section class="space-y-3">
            <p class="text-xs font-black text-accent">共同內容（每個決定都一樣）</p>
            <div>
              <label :class="lbl">治療溝通及說明</label>
              <textarea v-model="spec.explanation" rows="5" :class="area" placeholder="如：解釋X光檢查報告。治療方式優缺點：1.保守治療… 2.手術治療…" />
            </div>
            <div>
              <label :class="lbl">醫病共享決策進行方式（建議勾選）</label>
              <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                <label v-for="m in SDM_METHODS" :key="m" class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" :checked="spec.methods.includes(m)" @change="toggleMethod(m)" /> {{ m }}
                </label>
              </div>
              <input v-model="spec.methodsOther" :class="[input, 'mt-2']" placeholder="其他（可空白）" />
            </div>
            <div class="space-y-2">
              <label :class="lbl">自訂欄位（例如出院準備、末期照護等收合區塊）</label>
              <div v-for="(f, i) in spec.extra" :key="i" class="flex gap-2 items-start">
                <input v-model="f.label" :class="[input, 'w-40 shrink-0']" placeholder="欄位標題" />
                <textarea v-model="f.value" rows="2" :class="area" placeholder="內容" />
                <button @click="spec.extra.splice(i, 1)" class="text-muted hover:text-danger text-lg px-1 cursor-pointer">×</button>
              </div>
              <button @click="addField(spec.extra)" class="text-xs text-accent font-bold cursor-pointer">＋ 自訂欄位</button>
            </div>
          </section>

          <!-- 決定 -->
          <section class="space-y-3">
            <div class="flex items-center gap-2">
              <p class="text-xs font-black text-accent">病人的決定</p>
              <span class="text-xs text-muted">例如「手術」「保守治療」，各自填照護方向與要勾的項目</span>
              <button @click="addDecision" class="ml-auto text-xs text-accent font-bold cursor-pointer">＋ 新增決定</button>
            </div>
            <div v-for="(d, i) in spec.decisions" :key="d.id" class="border border-hairline rounded-2xl p-4 space-y-3 bg-sunken/40">
              <div class="flex items-center gap-2">
                <input v-model="d.name" :class="[input, 'flex-1']" :placeholder="spec.decisions.length > 1 ? '決定名稱（必填），如：手術' : '決定名稱（只有一個時可空白）'" />
                <button v-if="spec.decisions.length > 1" @click="removeDecision(i)" class="text-xs text-danger font-bold px-2 cursor-pointer">刪除此決定</button>
              </div>
              <div>
                <label :class="lbl">確認照護方向</label>
                <input v-model="d.careDirection" :class="input" placeholder="如：手術治療" />
              </div>
              <div>
                <label :class="lbl">其它</label>
                <textarea v-model="d.other" rows="3" :class="area" placeholder="如：手術自費耗材說明…" />
              </div>
              <div>
                <label :class="lbl">病家意向</label>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <label v-for="v in SDM_INTENTS" :key="v" class="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" :name="`intent-${d.id}`" :checked="d.intent === v" @change="d.intent = v" /> {{ v }}
                  </label>
                  <button v-if="d.intent" @click="d.intent = ''" class="text-xs text-muted hover:text-fg cursor-pointer">清除</button>
                  <input v-if="d.intent === '其他'" v-model="d.intentOther" :class="[input, 'w-48']" placeholder="其他說明" />
                </div>
              </div>
              <div class="space-y-2">
                <label :class="lbl">手術、檢查或治療</label>
                <div v-for="r in CONSENT_ROWS" :key="r.key" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span class="w-10 font-bold text-fg-secondary">{{ r.label }}</span>
                  <label v-for="v in SDM_CONSENTS" :key="v" class="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" :name="`${r.key}-${d.id}`" :checked="d[r.key] === v" @change="d[r.key] = v" /> {{ v }}
                  </label>
                  <button v-if="d[r.key]" @click="d[r.key] = ''" class="text-xs text-muted hover:text-fg cursor-pointer">清除</button>
                  <input v-if="r.key === 'surgery'" v-model="d.surgeryName" :class="[input, 'w-64']" placeholder="手術名稱" />
                  <input v-if="r.key === 'exam'" v-model="d.examName" :class="[input, 'w-64']" placeholder="檢查名稱" />
                </div>
              </div>
              <div class="space-y-2">
                <label :class="lbl">此決定的自訂欄位</label>
                <div v-for="(f, j) in d.extra" :key="j" class="flex gap-2 items-start">
                  <input v-model="f.label" :class="[input, 'w-40 shrink-0']" placeholder="欄位標題" />
                  <textarea v-model="f.value" rows="2" :class="area" placeholder="內容" />
                  <button @click="d.extra.splice(j, 1)" class="text-muted hover:text-danger text-lg px-1 cursor-pointer">×</button>
                </div>
                <button @click="addField(d.extra)" class="text-xs text-accent font-bold cursor-pointer">＋ 自訂欄位</button>
              </div>
            </div>
          </section>
        </div>

        <div class="px-6 py-4 border-t border-hairline shrink-0 bg-sunken space-y-2">
          <div v-if="errors.length" class="text-xs text-danger font-bold">{{ errors.join("；") }}</div>
          <div class="flex items-center gap-3">
            <label class="text-xs text-muted font-bold">修改人</label>
            <input v-model="editor" :class="[input, 'w-40']" placeholder="你的姓名（必填）" />
            <span class="text-xs text-muted">這台電腦會記住</span>
            <div class="ml-auto flex gap-3">
              <button @click="emit('close')" class="px-4 py-2 bg-elevated hover:bg-raised text-fg-secondary text-xs font-bold rounded-xl cursor-pointer">取消</button>
              <button @click="save" :disabled="!canSave"
                class="px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl cursor-pointer">儲存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
