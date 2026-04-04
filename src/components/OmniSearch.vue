<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { getDb } from "@/db";

const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const query  = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

interface Result {
  type: string;
  label: string;
  sub: string;
  route: string;
  copyCode?: string;   // 自費品項可直接複製院內碼
}

// 模組級快取：關閉再開 Ctrl+K 不重新查詢
let _searchCache: Result[] | null = null;

const allItems = ref<Result[]>([]);
const copiedCode = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

onMounted(async () => {
  inputRef.value?.focus();
  if (_searchCache) { allItems.value = _searchCache; return; }
  try {
    const db = await getDb();

    const [meds, rxs, diseases, exams, surgeries, protos, items, physicians, sets] =
      await Promise.all([
        db.select<{ name: string; route: string; category: string }[]>(
          "SELECT name, route, category FROM medications"),
        db.select<{ name: string; category: string }[]>(
          "SELECT name, category FROM prescriptions"),
        db.select<{ name: string; icd10: string }[]>(
          "SELECT name, icd10 FROM disease"),
        db.select<{ name: string; category: string }[]>(
          "SELECT name, category FROM examination"),
        db.select<{ name: string; category: string }[]>(
          "SELECT name, category FROM surgery"),
        db.select<{ name: string }[]>(
          "SELECT name FROM emergency_protocols"),
        db.select<{ hospital_code: string; name_zh: string; name_en: string; purpose: string; price: number }[]>(
          "SELECT hospital_code, name_zh, name_en, purpose, price FROM items"),
        db.select<{ name: string; department: string; title: string; ext: string }[]>(
          "SELECT name, department, title, ext FROM physicians"),
        db.select<{ name: string; surgery_type: string; doctor: string }[]>(`
          SELECT s.name, s.surgery_type,
                 COALESCE(p.name, '') as doctor
          FROM sets s LEFT JOIN physicians p ON s.physician_id = p.id`),
      ]);

    _searchCache = [
      ...meds.map((m) => ({ type: "藥物", label: m.name, sub: [m.route, m.category].filter(Boolean).join(" · "), route: "/medications" })),
      ...rxs.map((m) => ({ type: "處方", label: m.name, sub: m.category ?? "", route: "/prescriptions" })),
      ...diseases.map((m) => ({ type: "疾病", label: m.name, sub: m.icd10 ?? "", route: "/disease" })),
      ...exams.map((m) => ({ type: "檢查", label: m.name, sub: m.category ?? "", route: "/examination" })),
      ...surgeries.map((m) => ({ type: "手術", label: m.name, sub: m.category ?? "", route: "/surgery" })),
      ...protos.map((m) => ({ type: "急救", label: m.name, sub: "Emergency Protocol", route: "/emergency" })),
      ...items.map((m) => ({
        type: "自費",
        label: m.name_zh || m.name_en || m.hospital_code,
        sub: [m.hospital_code, m.purpose, m.price ? `$${m.price.toLocaleString()}` : ""].filter(Boolean).join(" · "),
        route: "/items",
        copyCode: m.hospital_code,
      })),
      ...physicians.map((m) => ({
        type: "醫師",
        label: m.name,
        sub: [m.department, m.title, m.ext ? `分機 ${m.ext}` : ""].filter(Boolean).join(" · "),
        route: "/physicians",
      })),
      ...sets.map((m) => ({
        type: "套組",
        label: m.name,
        sub: [m.surgery_type, m.doctor].filter(Boolean).join(" · "),
        route: "/sets",
      })),
    ];
    allItems.value = _searchCache;
  } catch {
    // DB not ready
  }
});

const results = computed(() => {
  const q = query.value.toLowerCase().trim();
  if (!q) return allItems.value.slice(0, 8);
  return allItems.value
    .filter((r) =>
      r.label.toLowerCase().includes(q) ||
      r.sub.toLowerCase().includes(q) ||
      r.type.includes(query.value)
    )
    .slice(0, 14);
});

const activeIdx = ref(0);

function onKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") { activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1); e.preventDefault(); }
  if (e.key === "ArrowUp")   { activeIdx.value = Math.max(activeIdx.value - 1, 0); e.preventDefault(); }
  if (e.key === "Enter" && results.value[activeIdx.value]) select(results.value[activeIdx.value]);
}

function select(r: Result) {
  router.push(r.route);
  emit("close");
}

async function copyAndClose(code: string, e: MouseEvent) {
  e.stopPropagation();
  await navigator.clipboard.writeText(code);
  copiedCode.value = code;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedCode.value = null; }, 1200);
}

const typeColors: Record<string, string> = {
  "藥物": "bg-blue-900/60 text-blue-300",
  "處方": "bg-green-900/60 text-green-300",
  "疾病": "bg-amber-900/60 text-amber-300",
  "檢查": "bg-purple-900/60 text-purple-300",
  "手術": "bg-orange-900/60 text-orange-300",
  "急救": "bg-red-900/60 text-red-300",
  "自費": "bg-teal-900/60 text-teal-300",
  "醫師": "bg-indigo-900/60 text-indigo-300",
  "套組": "bg-pink-900/60 text-pink-300",
};
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" @click.self="emit('close')">
    <div class="w-full max-w-xl bg-gray-900 rounded-xl border border-gray-700 shadow-2xl overflow-hidden">

      <!-- 輸入列 -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <span class="text-gray-500 text-base">🔍</span>
        <input
          ref="inputRef"
          v-model="query"
          @keydown="onKeydown"
          placeholder="搜尋藥物、自費品項、醫師、套組…"
          class="flex-1 bg-transparent text-gray-100 text-sm placeholder-gray-500 focus:outline-none"
        />
        <kbd class="text-gray-600 text-xs font-mono border border-gray-700 rounded px-1.5 py-0.5">ESC</kbd>
      </div>

      <!-- 結果列表 -->
      <ul class="max-h-96 overflow-y-auto py-1">
        <li v-if="results.length === 0" class="text-gray-500 text-sm text-center py-8">
          無結果
        </li>
        <li
          v-for="(r, idx) in results"
          :key="`${r.type}-${r.label}-${idx}`"
          @click="select(r)"
          @mouseenter="activeIdx = idx"
          class="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
          :class="activeIdx === idx ? 'bg-gray-800' : 'hover:bg-gray-800/50'"
        >
          <!-- 類型標籤 -->
          <span
            class="px-1.5 py-0.5 rounded text-xs font-semibold shrink-0 w-8 text-center"
            :class="typeColors[r.type] ?? 'bg-gray-800 text-gray-400'"
          >{{ r.type }}</span>

          <!-- 品名 + 副資訊 -->
          <div class="flex-1 min-w-0">
            <p class="text-gray-100 text-sm truncate">{{ r.label }}</p>
            <p class="text-gray-500 text-xs truncate">{{ r.sub }}</p>
          </div>

          <!-- 自費品項：複製院內碼按鈕 -->
          <button
            v-if="r.copyCode"
            @click="copyAndClose(r.copyCode, $event)"
            class="shrink-0 text-xs px-2 py-0.5 rounded transition-colors"
            :class="copiedCode === r.copyCode
              ? 'bg-green-800/60 text-green-400'
              : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-teal-400'"
          >
            {{ copiedCode === r.copyCode ? "✓ 已複製" : "複製碼" }}
          </button>

          <span v-else class="text-gray-700 text-xs shrink-0">↵</span>
        </li>
      </ul>

      <!-- Footer -->
      <div class="flex items-center gap-4 px-4 py-2 border-t border-gray-800 text-xs text-gray-600">
        <span>↑↓ 導航</span>
        <span>↵ 前往</span>
        <span>自費可直接複製院內碼</span>
        <span class="ml-auto">ESC 關閉</span>
      </div>
    </div>
  </div>
</template>
