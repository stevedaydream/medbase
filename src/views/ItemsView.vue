<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { refDebounced } from "@vueuse/core";
import { getDb } from "@/db";

interface Item {
  hospital_code: string;
  name_en: string | null;
  name_zh: string | null;
  purpose: string | null;   // 產品用途（止血劑/Mesh/骨板…）
  unit: string | null;
  price: number | null;
  supplier: string | null;
  notes: string | null;
  depts: string[];          // 來自 item_depts（前端合併）
}

// 固定用途清單（L1 標籤）
const PURPOSE_LIST = [
  "止血劑", "Mesh人工網膜", "骨板", "骨釘", "骨水泥",
  "關節假體", "傷口敷料", "引流耗材", "縫合材料", "內視鏡耗材", "其他",
];

const DEPT_LIST = ["骨科", "一般外科", "胸腔外科", "泌尿科", "乳房外科", "其他科"];

const items      = ref<Item[]>([]);
const searchRaw  = ref("");
const search     = refDebounced(searchRaw, 300);
const loading    = ref(true);
const activePurpose = ref("__all__");
const activeDept    = ref("__all__");
const copiedCode    = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

const errMsg = ref("");

onMounted(async () => {
  try {
    await loadItems();
  } catch (e) { errMsg.value = `載入失敗：${(e as Error).message}`; }
  finally { loading.value = false; }
});

async function loadItems() {
  const db = await getDb();
  const raw = await db.select<Omit<Item, "depts">[]>(
    "SELECT * FROM items ORDER BY name_zh"
  );
  const deptRows = await db.select<{ hospital_code: string; dept: string }[]>(
    "SELECT hospital_code, dept FROM item_depts"
  );
  const deptMap = new Map<string, string[]>();
  for (const r of deptRows) {
    if (!deptMap.has(r.hospital_code)) deptMap.set(r.hospital_code, []);
    deptMap.get(r.hospital_code)!.push(r.dept);
  }
  items.value = raw.map((it) => ({
    ...it,
    depts: deptMap.get(it.hospital_code) ?? [],
  }));
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    copiedCode.value = code;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedCode.value = null; }, 1500);
  } catch { /* clipboard denied */ }
}

// ── L1：用途標籤（固定清單 + 計數）────────────────────────────────
const purposeTags = computed(() => {
  const counts = new Map<string, number>();
  for (const it of items.value) {
    const key = it.purpose ?? "其他";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    { key: "__all__", label: "全部", count: items.value.length },
    ...PURPOSE_LIST
      .filter((p) => counts.has(p))
      .map((p) => ({ key: p, label: p, count: counts.get(p) ?? 0 })),
    // 不在固定清單中的用途也顯示
    ...[...counts.entries()]
      .filter(([k]) => !PURPOSE_LIST.includes(k))
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: key, count })),
  ];
});

function selectPurpose(key: string) {
  activePurpose.value = key;
  activeDept.value = "__all__";
}

// ── L2：科別子標籤（只在選定用途時，且有 item_depts 資料時顯示）───
const deptTags = computed(() => {
  if (activePurpose.value === "__all__") return [];
  const slice = purposeFiltered.value;
  const counts = new Map<string, number>();
  for (const it of slice) {
    for (const d of it.depts) {
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return [];
  return [
    { key: "__all__", label: "全部科別", count: slice.length },
    ...DEPT_LIST
      .filter((d) => counts.has(d))
      .map((d) => ({ key: d, label: d, count: counts.get(d)! })),
    ...[...counts.entries()]
      .filter(([k]) => !DEPT_LIST.includes(k))
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: key, count })),
  ];
});

// 中間層：僅 purpose 過濾（供 deptTags 計數用）
const purposeFiltered = computed(() => {
  if (activePurpose.value === "__all__") return items.value;
  return items.value.filter((m) => (m.purpose ?? "其他") === activePurpose.value);
});

// ── 最終過濾 ─────────────────────────────────────────────────────
const filtered = computed(() => {
  let list = purposeFiltered.value;

  // L2 科別
  if (activeDept.value !== "__all__") {
    list = list.filter((m) => m.depts.includes(activeDept.value));
  }

  // 關鍵字
  const q = search.value.toLowerCase().trim();
  if (q) {
    list = list.filter((m) =>
      m.name_zh?.toLowerCase().includes(q) ||
      m.name_en?.toLowerCase().includes(q) ||
      m.hospital_code?.toLowerCase().includes(q) ||
      m.purpose?.toLowerCase().includes(q) ||
      m.supplier?.toLowerCase().includes(q) ||
      m.depts.some((d) => d.toLowerCase().includes(q))
    );
  }
  return list;
});
</script>

<template>
  <div class="flex flex-col h-full gap-3">

    <!-- ── 搜尋列 ─────────────────────────────────── -->
    <div class="flex items-center gap-3">
      <input
        v-model="searchRaw"
        placeholder="搜尋品名 / 院內碼 / 用途 / 科別 / 廠商…"
        class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500"
      />
      <span class="text-xs text-gray-500 shrink-0">{{ filtered.length }} / {{ items.length }} 筆</span>
    </div>

    <!-- ── L1 用途標籤 ─────────────────────────────── -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="tag in purposeTags" :key="tag.key"
        @click="selectPurpose(tag.key)"
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
        :class="activePurpose === tag.key
          ? 'bg-teal-600 text-white shadow shadow-teal-900'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700'"
      >
        {{ tag.label }}
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-mono"
          :class="activePurpose === tag.key ? 'bg-teal-500 text-white' : 'bg-gray-700 text-gray-400'"
        >{{ tag.count }}</span>
      </button>
    </div>

    <!-- ── L2 科別子標籤（有才顯示） ─────────────────── -->
    <Transition name="slide-down">
      <div
        v-if="deptTags.length > 0"
        class="flex flex-wrap gap-1.5 pl-2 border-l-2 border-teal-700"
      >
        <button
          v-for="tag in deptTags" :key="tag.key"
          @click="activeDept = tag.key"
          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all"
          :class="activeDept === tag.key
            ? 'bg-cyan-500 text-white'
            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-cyan-300 border border-gray-700'"
        >
          {{ tag.label }}
          <span
            class="rounded-full px-1 text-[10px] font-mono"
            :class="activeDept === tag.key ? 'bg-cyan-400 text-white' : 'bg-gray-700 text-gray-500'"
          >{{ tag.count }}</span>
        </button>
      </div>
    </Transition>

    <!-- ── 表格 ───────────────────────────────────── -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 overflow-auto min-h-0">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-900 z-10">
          <tr class="border-b border-gray-800 text-gray-500 text-xs">
            <th class="text-left px-4 py-3 font-medium">院內碼</th>
            <th class="text-left px-4 py-3 font-medium">中文品名</th>
            <th class="text-left px-4 py-3 font-medium">英文品名</th>
            <th class="text-left px-4 py-3 font-medium">用途</th>
            <th class="text-left px-4 py-3 font-medium">適用科別</th>
            <th class="text-right px-4 py-3 font-medium">自費金額</th>
            <th class="text-left px-4 py-3 font-medium">單位</th>
            <th class="text-left px-4 py-3 font-medium">廠商</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="errMsg">
            <td colspan="8" class="text-center text-red-400 py-12">{{ errMsg }}</td>
          </tr>
          <tr v-else-if="loading">
            <td colspan="8" class="text-center text-gray-500 py-12">載入中…</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="8" class="text-center text-gray-600 py-12">
              {{ search ? "找不到符合的品項" : "此分類無資料" }}
            </td>
          </tr>
          <tr
            v-for="m in filtered" :key="m.hospital_code"
            class="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors"
          >
            <td
              class="px-4 py-2.5 font-mono text-xs cursor-pointer select-none transition-colors"
              :class="copiedCode === m.hospital_code
                ? 'text-green-400'
                : 'text-gray-400 hover:text-teal-400'"
              :title="'複製 ' + m.hospital_code"
              @click="copyCode(m.hospital_code)"
            >
              {{ copiedCode === m.hospital_code ? "✓ 已複製" : m.hospital_code }}
            </td>
            <td class="px-4 py-2.5 text-gray-200 font-medium">{{ m.name_zh || "—" }}</td>
            <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.name_en || "—" }}</td>
            <td class="px-4 py-2.5">
              <span v-if="m.purpose"
                class="text-xs bg-teal-900/40 text-teal-300 px-2 py-0.5 rounded-full">
                {{ m.purpose }}
              </span>
              <span v-else class="text-gray-600 text-xs">—</span>
            </td>
            <td class="px-4 py-2.5">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="d in m.depts" :key="d"
                  class="text-xs bg-cyan-900/30 text-cyan-400 px-1.5 py-0.5 rounded"
                >{{ d }}</span>
                <span v-if="m.depts.length === 0" class="text-gray-600 text-xs">—</span>
              </div>
            </td>
            <td class="px-4 py-2.5 text-right text-green-400 font-mono">
              {{ m.price ? `$${m.price.toLocaleString()}` : "—" }}
            </td>
            <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.unit || "—" }}</td>
            <td class="px-4 py-2.5 text-gray-500 text-xs">{{ m.supplier || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active { transition: all 0.2s ease; }
.slide-down-enter-from,
.slide-down-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
