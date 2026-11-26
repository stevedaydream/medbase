<script setup lang="ts">
import { ref, onMounted } from "vue";
import { listExcelTemplates, downloadExcelTemplate, type ExcelTemplate } from "@/composables/useExcelTemplate";

const emit = defineEmits<{ close: []; toast: [msg: string] }>();
const list = ref<ExcelTemplate[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");

onMounted(async () => {
  try { list.value = await listExcelTemplates(); }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
});

async function download(t: ExcelTemplate) {
  busy.value = true;
  try {
    const p = await downloadExcelTemplate(t);
    if (p) emit("toast", `已存成：${p.split(/[\\/]/).pop()}`);
  } catch (e) {
    emit("toast", `下載失敗：${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

const fmt = (iso: string) => new Date(iso).toLocaleString();
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm text-xs" @click.self="emit('close')">
    <div class="bg-surface border border-hairline rounded-xl shadow-2xl p-5 w-[34rem] max-h-[80vh] flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-fg">Excel 排班表範本</h3>
        <button class="ml-auto text-muted hover:text-fg" @click="emit('close')">✕</button>
      </div>
      <p class="text-fg-secondary leading-relaxed">
        在 Excel 按「存範本到雲端」存的完整副本。換電腦時下載一份，打開後啟用巨集，按「0 雲端更新」就能接著排班。
        GAS 有開啟金鑰的話，要在 Excel 的「雲端設定」貼上這台電腦的金鑰。
      </p>
      <div v-if="loading" class="text-muted">讀取中…</div>
      <div v-else-if="error" class="px-2 py-1.5 rounded bg-danger/10 text-danger">{{ error }}</div>
      <div v-else-if="!list.length" class="text-muted">雲端還沒有範本。請先在 Excel 按「存範本到雲端」。</div>
      <div v-else class="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
        <div v-for="(t, i) in list" :key="t.id" class="flex items-center gap-2 px-2 py-1.5 rounded border border-hairline">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-fg truncate">{{ t.name }}</span>
              <span v-if="i === 0" class="px-1.5 rounded-full border border-accent text-accent">最新</span>
            </div>
            <div class="text-muted">{{ fmt(t.saved_at) }}<template v-if="t.by">・{{ t.by }}</template>・{{ mb(t.size) }}</div>
          </div>
          <button class="px-2.5 py-1 border border-hairline rounded hover:bg-elevated disabled:opacity-40" :disabled="busy" @click="download(t)">下載副本</button>
        </div>
      </div>
    </div>
  </div>
</template>
