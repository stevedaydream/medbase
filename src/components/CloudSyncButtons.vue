<script setup lang="ts">
import { computed, ref } from "vue";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { syncTable, NoBaselineError, syncLabel } from "@/composables/useTableSync";

/**
 * 逐筆同步的共用按鈕（ADR-011）。
 * 「⇅ 同步」：較新的版本為準，刪除會傳到其他電腦。
 * 「覆蓋」：以本機為準，雲端有、本機沒有的資料會在所有電腦上被刪除，需按兩次確認。
 * table 可傳多張表（例如通訊錄的人員＋單位分機），依序同步。
 */
const props = defineProps<{ table: string | string[] }>();
const emit = defineEmits<{
  (e: "synced"): void;
  (e: "message", msg: string): void;
}>();

const tables = computed(() => (Array.isArray(props.table) ? props.table : [props.table]));
const cloud = useCloudSettings();
const syncing = ref(false);
const confirmOverwrite = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

async function run(force: boolean) {
  await cloud.load();
  if (!cloud.gasUrl) { emit("message", "請先在「設定」頁面填入 GAS Web App URL"); return; }
  syncing.value = true;
  let inserted = 0, updated = 0, deleted = 0;
  const notes: string[] = [];
  const noBaseline: string[] = [];
  const failed: string[] = [];
  for (const t of tables.value) {
    setGlobalSyncing(t, true);
    try {
      const r = await syncTable(t, cloud.gasUrl, { force });
      inserted += r.inserted; updated += r.updated; deleted += r.deleted;
      if (r.message) notes.push(r.message);
    } catch (e) {
      if (e instanceof NoBaselineError) noBaseline.push(syncLabel(t));
      else failed.push(`${syncLabel(t)}：${(e as Error).message}`);
    } finally {
      setGlobalSyncing(t, false);
    }
  }
  syncing.value = false;
  emit("synced");
  if (failed.length) { emit("message", `${force ? "覆蓋" : "同步"}失敗｜${failed.join("；")}`); return; }
  if (noBaseline.length) {
    emit("message", `${noBaseline.join("、")}尚未建立同步基準：請先在資料最完整的電腦按「覆蓋」`);
    return;
  }
  const summary = `${force ? "已覆蓋雲端" : "同步完成"}：新增 ${inserted}、更新 ${updated}、刪除 ${deleted}`;
  emit("message", notes.length ? `${summary}｜${notes.join("｜")}` : summary);
}

function onOverwriteClick() {
  if (!confirmOverwrite.value) {
    confirmOverwrite.value = true;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmOverwrite.value = false; }, 3000);
    return;
  }
  confirmOverwrite.value = false;
  run(true);
}
</script>

<template>
  <div class="flex gap-2">
    <button @click="run(false)" :disabled="syncing"
      class="flex-1 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 disabled:opacity-50 transition-colors cursor-pointer"
      title="與雲端逐筆同步：較新的版本為準，刪除會傳到其他電腦">
      {{ syncing ? '…' : '⇅' }} 同步
    </button>
    <button @click="onOverwriteClick" :disabled="syncing"
      class="px-3 py-1.5 rounded-xl border text-xs font-bold disabled:opacity-50 transition-colors cursor-pointer"
      :class="confirmOverwrite ? 'bg-danger text-white border-danger' : 'bg-danger/5 border-danger/20 text-danger hover:bg-danger/15'"
      title="以本機為準覆蓋雲端：雲端有、本機沒有的資料會在所有電腦上被刪除">
      {{ confirmOverwrite ? '確定覆蓋？' : '覆蓋' }}
    </button>
  </div>
</template>
