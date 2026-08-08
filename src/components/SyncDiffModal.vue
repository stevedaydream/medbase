<script setup lang="ts">
import { ref, computed } from "vue";
import { SYNC_TABLE_META } from "@/composables/useSyncMonitor";

interface Row { [key: string]: unknown }

const props = defineProps<{
  table: string;
  localRows: Row[];
  cloudRows: Row[];
}>();

const emit = defineEmits<{
  confirm: [merged: Row[]];
  cancel: [];
}>();

type Choice = "local" | "cloud" | "added" | "deleted";

interface DiffRow {
  pk: unknown;
  local: Row | null;
  cloud: Row | null;
  choice: Choice;
  conflictKeys: string[];
}

const meta = computed(() => SYNC_TABLE_META[props.table]);
const label = computed(() => meta.value?.label ?? props.table);

function getChangedKeys(a: Row, b: Row): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

const diffRows = computed((): DiffRow[] => {
  const pk = meta.value?.primaryKey ?? "id";
  const cloudMap = new Map(props.cloudRows.map(r => [r[pk], r]));
  const localMap = new Map(props.localRows.map(r => [r[pk], r]));

  const allKeys = new Set([...localMap.keys(), ...cloudMap.keys()]);
  const rows: DiffRow[] = [];

  for (const key of allKeys) {
    const local = localMap.get(key) ?? null;
    const cloud = cloudMap.get(key) ?? null;

    if (local && cloud) {
      const changedKeys = getChangedKeys(local, cloud);
      if (changedKeys.length > 0) {
        rows.push({ pk: key, local, cloud, choice: "cloud", conflictKeys: changedKeys });
      }
    } else if (local && !cloud) {
      rows.push({ pk: key, local, cloud: null, choice: "local", conflictKeys: [] });
    } else if (!local && cloud) {
      rows.push({ pk: key, local: null, cloud, choice: "cloud", conflictKeys: [] });
    }
  }
  return rows;
});

const conflictCount = computed(() => diffRows.value.filter(r => r.local && r.cloud).length);

const rowChoices = ref<Map<unknown, Choice>>(new Map());

function getChoice(pk: unknown): Choice {
  return rowChoices.value.get(pk) ?? (diffRows.value.find(r => r.pk === pk)?.choice ?? "cloud");
}

function setChoice(pk: unknown, c: Choice) {
  rowChoices.value = new Map(rowChoices.value).set(pk, c);
}

function selectAll(c: "local" | "cloud") {
  const m = new Map<unknown, Choice>();
  diffRows.value.forEach(r => {
    if (r.local && r.cloud) m.set(r.pk, c);
  });
  rowChoices.value = m;
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" && v.length > 40) return v.slice(0, 40) + "…";
  return String(v);
}

function confirmMerge() {
  const pk = meta.value?.primaryKey ?? "id";
  const merged: Row[] = [];

  // Start from cloud rows (base), apply choices
  const cloudMap = new Map(props.cloudRows.map(r => [r[pk], r]));
  const localMap = new Map(props.localRows.map(r => [r[pk], r]));
  const allKeys  = new Set([...localMap.keys(), ...cloudMap.keys()]);

  for (const key of allKeys) {
    const row = diffRows.value.find(r => r.pk === key);
    if (!row) {
      // No diff — keep cloud version
      if (cloudMap.has(key)) merged.push(cloudMap.get(key)!);
      continue;
    }
    const choice = getChoice(key);
    if (choice === "local" && row.local) merged.push(row.local);
    else if (choice === "cloud" && row.cloud) merged.push(row.cloud);
    else if (choice === "added" && row.local) merged.push(row.local);
    // "deleted" → omit from merged
  }

  emit("confirm", merged);
}
</script>

<template>
  <div class="fixed inset-0 z-[9500] flex items-center justify-center bg-sunken/70 backdrop-blur-sm">
    <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-[780px] max-w-[95vw] max-h-[88vh] flex flex-col">

      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
        <div>
          <p class="text-fg font-bold text-sm">雲端資料差異 — {{ label }}</p>
          <p class="text-fg-secondary text-xs mt-0.5">{{ conflictCount }} 筆衝突，請選擇保留哪個版本</p>
        </div>
        <div class="flex gap-2">
          <button @click="selectAll('local')"
            class="text-xs px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors cursor-pointer">
            全選本地
          </button>
          <button @click="selectAll('cloud')"
            class="text-xs px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/30 text-warning hover:bg-warning/20 transition-colors cursor-pointer">
            全選雲端
          </button>
        </div>
      </div>

      <!-- Row list -->
      <div class="flex-1 overflow-y-auto min-h-0 p-4 space-y-2">
        <template v-for="row in diffRows" :key="row.pk">
          <!-- Added locally (cloud doesn't have) -->
          <div v-if="row.local && !row.cloud"
            class="rounded-xl border border-accent/20 bg-accent/30 p-3 flex items-center justify-between gap-4">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-2xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full shrink-0">本地新增</span>
              <span class="text-xs text-fg-secondary truncate">{{ formatValue(row.pk) }}</span>
            </div>
            <span class="text-2xs text-accent shrink-0">自動保留</span>
          </div>

          <!-- Deleted on cloud side -->
          <div v-else-if="!row.local && row.cloud"
            class="rounded-xl border border-warning/20 bg-warning/30 p-3 flex items-center justify-between gap-4">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-2xs font-bold text-warning bg-warning/10 px-2 py-0.5 rounded-full shrink-0">雲端新增</span>
              <span class="text-xs text-fg-secondary truncate">{{ formatValue(row.pk) }}</span>
            </div>
            <span class="text-2xs text-warning shrink-0">自動加入</span>
          </div>

          <!-- Conflict: both local and cloud changed -->
          <div v-else
            class="rounded-xl border p-3 space-y-2"
            :class="getChoice(row.pk) === 'local'
              ? 'border-accent/30 bg-accent/20'
              : 'border-warning/30 bg-warning/20'">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-2">
                <span class="text-2xs font-bold text-danger bg-danger/10 px-2 py-0.5 rounded-full">衝突</span>
                <span class="text-xs text-fg-secondary font-mono">{{ formatValue(row.pk) }}</span>
              </div>
              <div class="flex gap-1.5">
                <button
                  @click="setChoice(row.pk, 'local')"
                  :class="getChoice(row.pk) === 'local'
                    ? 'bg-accent text-white'
                    : 'bg-raised text-fg-secondary hover:bg-raised'"
                  class="text-[0.6875rem] px-3 py-1 rounded-lg transition-colors cursor-pointer">
                  本地版
                </button>
                <button
                  @click="setChoice(row.pk, 'cloud')"
                  :class="getChoice(row.pk) === 'cloud'
                    ? 'bg-warning text-white'
                    : 'bg-raised text-fg-secondary hover:bg-raised'"
                  class="text-[0.6875rem] px-3 py-1 rounded-lg transition-colors cursor-pointer">
                  雲端版
                </button>
              </div>
            </div>
            <!-- Conflict fields preview -->
            <div class="grid grid-cols-2 gap-2 text-[0.6875rem]">
              <div class="space-y-1">
                <p class="text-accent font-bold text-2xs">本地</p>
                <template v-for="k in row.conflictKeys" :key="k">
                  <div class="rounded px-2 py-1"
                    :class="row.local?.[k] !== row.cloud?.[k] ? 'bg-accent/30' : ''">
                    <span class="text-muted font-mono">{{ k }}: </span>
                    <span class="text-accent">{{ formatValue(row.local?.[k]) }}</span>
                  </div>
                </template>
              </div>
              <div class="space-y-1">
                <p class="text-warning font-bold text-2xs">雲端</p>
                <template v-for="k in row.conflictKeys" :key="k">
                  <div class="rounded px-2 py-1"
                    :class="row.local?.[k] !== row.cloud?.[k] ? 'bg-warning/30' : ''">
                    <span class="text-muted font-mono">{{ k }}: </span>
                    <span class="text-warning">{{ formatValue(row.cloud?.[k]) }}</span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>

        <div v-if="diffRows.length === 0" class="text-center text-muted text-sm py-8">
          無差異，資料完全一致
        </div>
      </div>

      <!-- Footer -->
      <div class="flex gap-3 justify-end px-6 py-4 border-t border-hairline shrink-0">
        <button @click="emit('cancel')"
          class="text-sm px-4 py-2 bg-raised hover:bg-raised text-fg-secondary rounded-lg transition-colors cursor-pointer">
          取消（保留本地）
        </button>
        <button @click="confirmMerge"
          class="text-sm px-5 py-2 bg-success hover:bg-success text-white rounded-lg font-semibold transition-colors cursor-pointer">
          確認套用
        </button>
      </div>
    </div>
  </div>
</template>
