<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { onTableSynced } from "@/composables/useTableSync";
import { loadSdm, saveSdm, deleteSdm, getEditorName, setEditorName, SDM_TABLE } from "@/composables/useSdm";
import { searchSdm, groupByDept, decisionSections, type SdmEntry } from "@/shared/sdm/types";
import CloudSyncButtons from "@/components/CloudSyncButtons.vue";
import SdmCopyField from "@/components/sdm/SdmCopyField.vue";
import SdmEditor from "@/components/sdm/SdmEditor.vue";

/**
 * SDM 範本（ADR-021）：依科別查詢，逐欄複製貼到 HIS「醫病共享決策紀錄」。
 * 一個範本可有多個決定（例如手術／保守治療），先選病人的決定再複製。
 */
const list = ref<SdmEntry[]>([]);
const search = ref("");
const selUid = ref<string | null>(null);
const decIdx = ref(0);
const editing = ref<SdmEntry | null | "new">(null);
const confirmDelete = ref(false);
const editor = ref("");

const toastMsg = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2000);
}
onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer); });

async function reload() {
  try {
    list.value = await loadSdm();
  } catch (e) {
    toast(`載入失敗：${(e as Error).message}`);
  }
}
onMounted(async () => {
  await reload();
  editor.value = await getEditorName().catch(() => "");
});
onTableSynced(SDM_TABLE, reload);

const groups = computed(() => groupByDept(searchSdm(list.value, search.value)));
const depts = computed(() => [...new Set(list.value.map(e => e.spec.dept.trim()).filter(Boolean))].sort());
const selected = computed(() => list.value.find(e => e.uid === selUid.value) ?? null);
const decision = computed(() => selected.value?.spec.decisions[decIdx.value] ?? selected.value?.spec.decisions[0] ?? null);
watch(selUid, () => { decIdx.value = 0; });

const consents = computed(() => {
  const d = decision.value;
  if (!d) return [];
  return [
    { label: "手術", v: d.surgery }, { label: "檢查", v: d.exam },
    { label: "氣切", v: d.trach }, { label: "插管", v: d.intubation },
  ].filter(x => x.v);
});
const sections = computed(() => selected.value && decision.value ? decisionSections(decision.value, selected.value.spec.explanation) : []);
const methods = computed(() => {
  const s = selected.value?.spec;
  if (!s) return [];
  return [...s.methods, ...(s.methodsOther.trim() ? ["其他"] : [])];
});

async function onSave(v: { name: string; spec: SdmEntry["spec"]; editor: string }) {
  try {
    const uid = await saveSdm({ uid: editing.value && editing.value !== "new" ? editing.value.uid : null, name: v.name, spec: v.spec }, v.editor);
    if (v.editor !== editor.value) { editor.value = v.editor; await setEditorName(v.editor); }
    editing.value = null;
    await reload();
    selUid.value = uid;
    toast("已儲存，將同步到全院電腦");
  } catch (e) {
    toast(`儲存失敗：${(e as Error).message}`);
  }
}

async function onDelete() {
  if (!selected.value) return;
  try {
    await deleteSdm(selected.value.uid);
    selUid.value = null;
    confirmDelete.value = false;
    await reload();
    toast("已刪除");
  } catch (e) {
    toast(`刪除失敗：${(e as Error).message}`);
  }
}
</script>

<template>
  <div class="accent-indigo flex gap-6 h-full text-fg bg-sunken">

    <!-- ── 左側：依科別分組的清單 ─────────────────── -->
    <div class="flex flex-col w-80 shrink-0 bg-surface border border-hairline rounded-2xl p-4 shadow-xl overflow-hidden">
      <div class="flex gap-2 mb-3 shrink-0">
        <input v-model="search" placeholder="搜尋範本、科別、手術名稱、內容…"
          class="flex-1 px-3 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs placeholder-muted outline-none focus:border-accent/50 font-bold" />
        <button @click="editing = 'new'"
          class="w-10 h-10 flex items-center justify-center rounded-xl bg-accent hover:bg-accent-hover text-white text-lg font-bold transition-all active:scale-95 cursor-pointer"
          title="新增 SDM 範本">＋</button>
      </div>
      <div class="flex items-center justify-between px-1.5 mb-3 shrink-0">
        <span class="text-muted text-xs font-black font-mono">{{ list.length }} 個範本</span>
        <CloudSyncButtons :table="SDM_TABLE" @synced="reload" @message="toast" />
      </div>
      <div class="flex-1 overflow-y-auto space-y-4 pr-1">
        <div v-if="!groups.length" class="text-muted text-xs italic text-center py-12">{{ list.length ? "找不到符合的範本" : "尚無範本，點 ＋ 新增" }}</div>
        <div v-for="g in groups" :key="g.dept">
          <p class="text-xs font-black text-accent px-1.5 mb-1.5">{{ g.dept }}（{{ g.items.length }}）</p>
          <div class="space-y-1.5">
            <button v-for="e in g.items" :key="e.uid" @click="selUid = e.uid"
              class="w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer"
              :class="selUid === e.uid ? 'bg-accent/15 border-accent/50 text-fg' : 'bg-sunken border-hairline text-fg-secondary hover:text-fg'">
              <div class="font-bold text-xs truncate">{{ e.name }}</div>
              <div v-if="e.spec.decisions.length > 1" class="text-xs mt-1 opacity-70 truncate">
                {{ e.spec.decisions.map(d => d.name).join("／") }}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 右側：範本內容，對照 HIS 表單由上往下 ───── -->
    <div class="flex-1 rounded-2xl bg-surface border border-hairline p-6 overflow-y-auto shadow-xl">
      <div v-if="!selected" class="h-full flex flex-col items-center justify-center gap-3 text-muted py-12">
        <span class="text-4xl">📝</span>
        <p class="text-xs font-black">請選擇 SDM 範本，或點 ＋ 新增</p>
        <span class="text-xs text-center max-w-xs leading-relaxed">對照 HIS「醫病共享決策紀錄」的欄位，逐欄複製後貼上。</span>
      </div>

      <div v-else class="space-y-5">
        <div class="flex items-start justify-between border-b border-hairline pb-4">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-base font-black text-fg">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-2 flex-wrap text-xs">
              <span v-if="selected.spec.dept" class="font-black bg-accent/10 border border-accent/30 text-accent px-2 py-0.5 rounded-full">{{ selected.spec.dept }}</span>
              <span v-if="selected.spec.updatedBy" class="text-muted">最後修改：{{ selected.spec.updatedBy }}　{{ selected.spec.updatedAt }}</span>
            </div>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button @click="editing = selected"
              class="px-3.5 py-2 rounded-xl border border-hairline bg-sunken hover:bg-elevated text-fg-secondary text-xs font-bold cursor-pointer">✏️ 編輯</button>
            <button @click="confirmDelete = true"
              class="px-3.5 py-2 rounded-xl border border-danger/30 bg-danger/10 hover:bg-danger/20 text-danger text-xs font-bold cursor-pointer">🗑 刪除</button>
          </div>
        </div>

        <!-- 表頭 -->
        <div v-if="selected.spec.purpose || selected.spec.purposeNote" class="space-y-2">
          <div v-if="selected.spec.purpose" class="px-4 py-3 rounded-xl border border-accent/40 bg-accent/10 text-xs">
            <span class="font-black text-accent">住院／門診主要目的請選：</span>
            <span class="font-bold text-fg select-text">{{ selected.spec.purpose }}</span>
          </div>
          <SdmCopyField v-if="selected.spec.purposeNote" label="主要目的補充" :value="selected.spec.purposeNote" />
        </div>

        <!-- 決定切換 -->
        <div v-if="selected.spec.decisions.length > 1" class="space-y-1.5">
          <p class="text-xs font-black text-muted">病人的決定</p>
          <div class="flex gap-1 p-1 bg-sunken rounded-xl border border-hairline w-fit">
            <button v-for="(d, i) in selected.spec.decisions" :key="d.id" @click="decIdx = i"
              class="px-4 py-2 rounded-lg text-xs font-black cursor-pointer"
              :class="decIdx === i ? 'bg-elevated text-accent border border-hairline shadow' : 'text-muted hover:text-fg-secondary'">{{ d.name }}</button>
          </div>
        </div>

        <!-- 要勾的大項 -->
        <div v-if="sections.length" class="text-xs px-4 py-2.5 rounded-xl bg-sunken border border-hairline">
          <span class="font-black text-muted">討論主要目的請勾：</span>
          <span class="font-bold text-fg">{{ sections.join("、") }}</span>
        </div>

        <!-- 重大病情討論 -->
        <div v-if="decision" class="space-y-2">
          <SdmCopyField v-if="selected.spec.explanation" label="治療溝通及說明" :value="selected.spec.explanation" />
          <SdmCopyField v-if="decision.careDirection" label="確認照護方向" :value="decision.careDirection" />
          <SdmCopyField v-if="decision.other" label="其它" :value="decision.other" />
          <div v-if="decision.intent" class="text-xs px-4 py-2.5 rounded-xl bg-sunken border border-hairline">
            <span class="font-black text-muted">病家意向請勾：</span>
            <span class="font-bold text-fg">{{ decision.intent }}</span>
          </div>
          <SdmCopyField v-if="decision.intent === '其他' && decision.intentOther" label="病家意向：其他" :value="decision.intentOther" />
        </div>

        <!-- 手術、檢查或治療 -->
        <div v-if="decision && (consents.length || decision.surgeryName || decision.examName)" class="space-y-2">
          <div v-if="consents.length" class="text-xs px-4 py-2.5 rounded-xl bg-sunken border border-hairline flex flex-wrap gap-x-4 gap-y-1">
            <span class="font-black text-muted">手術、檢查或治療請勾：</span>
            <span v-for="c in consents" :key="c.label" class="font-bold text-fg">{{ c.label }}－{{ c.v }}</span>
          </div>
          <SdmCopyField v-if="decision.surgeryName" label="手術名稱" :value="decision.surgeryName" />
          <SdmCopyField v-if="decision.examName" label="檢查名稱" :value="decision.examName" />
        </div>

        <!-- 自訂欄位 -->
        <div v-if="selected.spec.extra.length || decision?.extra.length" class="space-y-2">
          <SdmCopyField v-for="(f, i) in [...selected.spec.extra, ...(decision?.extra ?? [])]" :key="i" :label="f.label" :value="f.value" />
        </div>

        <!-- 進行方式 -->
        <div v-if="methods.length" class="space-y-2">
          <div class="text-xs px-4 py-2.5 rounded-xl bg-sunken border border-hairline">
            <span class="font-black text-muted">醫病共享決策進行方式請勾：</span>
            <span class="font-bold text-fg">{{ methods.join("、") }}</span>
          </div>
          <SdmCopyField v-if="selected.spec.methodsOther" label="進行方式：其他" :value="selected.spec.methodsOther" />
        </div>
      </div>
    </div>

    <SdmEditor v-if="editing" :entry="editing === 'new' ? null : editing" :depts="depts" :editor="editor"
      @close="editing = null" @save="onSave" />

    <Teleport to="body">
      <div v-if="confirmDelete" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm" @click.self="confirmDelete = false">
        <div class="bg-surface border border-hairline rounded-2xl shadow-2xl p-6 w-full max-w-sm text-fg">
          <p class="font-bold text-sm mb-1">確認刪除</p>
          <p class="text-fg-secondary text-xs mb-5">確定刪除「{{ selected?.name }}」？全院電腦同步後都會刪除，無法復原。</p>
          <div class="flex justify-end gap-3">
            <button @click="confirmDelete = false" class="px-4 py-2 bg-elevated hover:bg-raised text-fg-secondary text-xs font-bold rounded-xl cursor-pointer">取消</button>
            <button @click="onDelete" class="px-4 py-2 bg-danger text-white text-xs font-bold rounded-xl cursor-pointer">確定刪除</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-surface/90 border border-hairline text-fg text-xs font-bold rounded-2xl shadow-2xl pointer-events-none z-50">
        {{ toastMsg }}
      </div>
    </Teleport>
  </div>
</template>
