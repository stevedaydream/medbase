<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { loadAllHits } from "@/search";
import { searchHits, type SearchHit } from "@/search/types";

/**
 * 全域搜尋（Ctrl+K，ADR-024）：來源由 src/search/providers/ 自動讀取，
 * 點結果前往該頁並直接選中那一筆（?focus=）。
 */
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const query  = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

// 上次的索引：開啟時先顯示避免空白，同時重新載入，
// 否則本次開啟 app 期間新增或修改的資料要重開才搜得到
let _searchCache: SearchHit[] | null = null;

const allItems = ref<SearchHit[]>([]);
const copiedCode = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

onMounted(async () => {
  inputRef.value?.focus();
  if (_searchCache) allItems.value = _searchCache;
  try {
    _searchCache = await loadAllHits();
    allItems.value = _searchCache;
  } catch {
    // DB not ready
  }
});

const results = computed(() => (query.value.trim() ? searchHits(allItems.value, query.value) : []));

const activeIdx = ref(0);
// 輸入改變或索引重新載入後，選取回到第一筆，避免停在已不存在的位置而按 Enter 沒反應
watch(results, () => { activeIdx.value = 0; });

function onKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") { activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1); e.preventDefault(); }
  if (e.key === "ArrowUp")   { activeIdx.value = Math.max(activeIdx.value - 1, 0); e.preventDefault(); }
  if (e.key === "Enter" && results.value[activeIdx.value]) select(results.value[activeIdx.value]);
}

function select(r: SearchHit) {
  router.push(r.route);
  emit("close");
}

async function copyCode(code: string, e: MouseEvent) {
  e.stopPropagation();
  await navigator.clipboard.writeText(code);
  copiedCode.value = code;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedCode.value = null; }, 1200);
}

const typeColors: Record<string, string> = {
  "疾病": "bg-warning/10 text-warning",
  "判讀": "bg-danger/10 text-danger",
};
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" @click.self="emit('close')">
    <div class="w-full max-w-xl bg-surface rounded-xl border border-hairline shadow-2xl overflow-hidden">

      <!-- 輸入列 -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-hairline">
        <span class="text-muted text-base">🔍</span>
        <input
          ref="inputRef"
          v-model="query"
          @keydown="onKeydown"
          placeholder="搜尋套組、SDM、自費品項、人員、手冊、備忘錄…"
          class="flex-1 bg-transparent text-fg text-sm placeholder-muted focus:outline-none"
        />
        <kbd class="text-muted text-xs font-mono border border-hairline rounded px-1.5 py-0.5">ESC</kbd>
      </div>

      <!-- 結果列表 -->
      <ul class="max-h-96 overflow-y-auto py-1">
        <li v-if="!query.trim()" class="text-muted text-sm text-center py-8">輸入關鍵字開始搜尋（可用空白分隔多個字）</li>
        <li v-else-if="results.length === 0" class="text-muted text-sm text-center py-8">無結果</li>
        <li
          v-for="(r, idx) in results"
          :key="`${r.type}-${r.route}-${idx}`"
          @click="select(r)"
          @mouseenter="activeIdx = idx"
          class="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
          :class="activeIdx === idx ? 'bg-elevated' : 'hover:bg-elevated/50'"
        >
          <!-- 類型標籤 -->
          <span
            class="px-1.5 py-0.5 rounded text-xs font-semibold shrink-0 min-w-8 text-center"
            :class="typeColors[r.type] ?? 'bg-accent/10 text-accent'"
          >{{ r.type }}</span>

          <!-- 標題 + 副資訊 -->
          <div class="flex-1 min-w-0">
            <p class="text-fg text-sm truncate">{{ r.label }}</p>
            <p class="text-muted text-xs truncate">{{ r.sub }}</p>
          </div>

          <button
            v-if="r.copy"
            @click="copyCode(r.copy.text, $event)"
            class="shrink-0 text-xs px-2 py-0.5 rounded transition-colors"
            :class="copiedCode === r.copy.text
              ? 'bg-accent/10 text-accent'
              : 'bg-elevated text-muted hover:bg-raised hover:text-accent'"
          >
            {{ copiedCode === r.copy.text ? "✓ 已複製" : r.copy.label }}
          </button>

          <span v-else class="text-muted text-xs shrink-0">↵</span>
        </li>
      </ul>

      <!-- Footer -->
      <div class="flex items-center gap-4 px-4 py-2 border-t border-hairline text-xs text-muted">
        <span>↑↓ 導航</span>
        <span>↵ 前往並開啟</span>
        <span>自費可直接複製院內碼</span>
        <span class="ml-auto">ESC 關閉</span>
      </div>
    </div>
  </div>
</template>
