<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

defineOptions({ name: "FileTree" });

/**
 * 資料夾樹：只列出子資料夾與 Markdown／文字檔，展開時才讀取（大資料夾不卡）。
 * version 改變時重新讀取（新增檔案、手動重新整理）。
 */
const props = withDefaults(defineProps<{ dir: string; depth?: number; active?: string | null; openPaths?: string[]; version?: number }>(), {
  depth: 0, active: null, openPaths: () => [], version: 0,
});
const emit = defineEmits<{ (e: "open", path: string): void; (e: "newFile", dir: string): void }>();

interface Entry { name: string; path: string; dir: boolean }
const entries = ref<Entry[]>([]);
const expanded = ref(new Set<string>());
const error = ref("");

const MD = /\.(md|markdown|txt)$/i;
const SKIP = new Set(["node_modules", ".git", ".obsidian", "$RECYCLE.BIN", "System Volume Information"]);

async function load() {
  try {
    const list = await readDir(props.dir);
    const out: Entry[] = [];
    for (const e of list) {
      if (!e.name || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      if (e.isDirectory || (e.isFile && MD.test(e.name))) out.push({ name: e.name, path: await join(props.dir, e.name), dir: e.isDirectory });
    }
    entries.value = out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "zh-TW", { numeric: true }) : a.dir ? -1 : 1));
    error.value = "";
  } catch (e) {
    error.value = `無法讀取：${(e as Error).message ?? e}`;
  }
}
onMounted(load);
watch(() => [props.dir, props.version], load);

function toggle(p: string) {
  const s = new Set(expanded.value);
  if (s.has(p)) s.delete(p); else s.add(p);
  expanded.value = s;
}
const norm = (p: string | null) => (p ?? "").replace(/\\/g, "/").toLowerCase();
const isActive = (p: string) => norm(p) === norm(props.active);
const isOpen = (p: string) => props.openPaths.some(o => norm(o) === norm(p));
</script>

<template>
  <ul class="text-xs">
    <li v-if="error" class="px-2 py-1 text-danger">{{ error }}</li>
    <li v-else-if="!entries.length && depth === 0" class="px-2 py-3 text-muted">這個資料夾沒有 Markdown 檔案</li>
    <li v-for="e in entries" :key="e.path">
      <div class="group flex items-center gap-1 rounded-md pr-1 hover:bg-overlay/5 cursor-pointer select-none"
        :style="{ paddingLeft: `${depth * 0.75 + 0.25}rem` }"
        :class="isActive(e.path) ? 'bg-accent/10 text-accent font-bold' : 'text-fg-secondary'"
        :title="e.path" @click="e.dir ? toggle(e.path) : emit('open', e.path)">
        <span class="w-3 shrink-0 text-muted text-2xs">{{ e.dir ? (expanded.has(e.path) ? '▾' : '▸') : '' }}</span>
        <span class="shrink-0">{{ e.dir ? '📁' : '📄' }}</span>
        <span class="flex-1 min-w-0 truncate py-1">{{ e.name }}</span>
        <span v-if="!e.dir && isOpen(e.path)" class="w-1.5 h-1.5 rounded-full bg-accent/60 shrink-0" title="已開啟" />
        <button v-if="e.dir" @click.stop="emit('newFile', e.path)" title="在這個資料夾新增文件"
          class="opacity-0 group-hover:opacity-100 px-1 text-muted hover:text-accent cursor-pointer">＋</button>
      </div>
      <FileTree v-if="e.dir && expanded.has(e.path)" :dir="e.path" :depth="depth + 1" :active="active" :open-paths="openPaths"
        :version="version" @open="emit('open', $event)" @new-file="emit('newFile', $event)" />
    </li>
  </ul>
</template>
