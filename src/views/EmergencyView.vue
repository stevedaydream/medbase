<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { loadEmergencyCards, EM_TABLE } from "@/composables/useEmergency";
import { onTableSynced } from "@/composables/useTableSync";
import { searchCards, visibleCards } from "@/shared/emergency/logic";
import EmergencyCardPanel from "@/components/emergency/EmergencyCardPanel.vue";
import { EM_CATEGORIES, type EmCard } from "@/shared/emergency/types";

/** 數值判讀（ADR-017）：選卡 → 輸入數值、回答是非題 → 顯示符合級距的處置 */
const cards = ref<EmCard[]>([]);
const q = ref("");
const selected = ref<EmCard | null>(null);

const route = useRoute();
async function reload() {
  cards.value = visibleCards(await loadEmergencyCards());
  if (selected.value) selected.value = cards.value.find(c => c.uid === selected.value!.uid) ?? null;
  else openFromQuery();
}
function openFromQuery() {
  const c = cards.value.find(x => x.uid === route.query.c);
  if (c && selected.value?.uid !== c.uid) pick(c);
}
watch(() => route.query.c, openFromQuery);
onMounted(reload);
onTableSynced(EM_TABLE, reload);

const list = computed(() => searchCards(cards.value, q.value));
const groups = computed(() => {
  const cats = [...EM_CATEGORIES, ...new Set(list.value.map(c => c.spec.category))];
  return [...new Set(cats)].map(cat => ({ cat, items: list.value.filter(c => c.spec.category === cat) })).filter(g => g.items.length);
});

function pick(c: EmCard) {
  selected.value = c;
}

</script>

<template>
  <div class="accent-rose flex gap-4 h-full bg-sunken rounded-2xl border border-hairline p-1 overflow-hidden">
    <!-- 左：卡片清單 -->
    <div class="w-72 shrink-0 flex flex-col bg-surface rounded-xl border border-hairline p-3 gap-3">
      <div class="flex items-center gap-2">
        <span class="text-lg">📊</span>
        <p class="text-sm font-bold text-fg">數值判讀</p>
      </div>
      <input v-model="q" placeholder="搜尋：症狀、項目（例：喘、K、低血壓）"
        class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-xs text-fg" />
      <div class="flex-1 overflow-y-auto space-y-3 pr-1">
        <div v-for="g in groups" :key="g.cat">
          <p class="text-xs font-bold text-muted mb-1">{{ g.cat }}</p>
          <button v-for="c in g.items" :key="c.uid" @click="pick(c)"
            class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border text-xs"
            :class="selected?.uid === c.uid ? 'bg-danger/10 border-danger/30 text-danger font-bold' : 'bg-sunken border-hairline text-fg-secondary hover:text-fg'">
            {{ c.name }}
            <span v-if="c.spec.status === 'literature'" class="ml-1 text-xs text-warning">文獻版</span>
          </button>
        </div>
        <p v-if="!list.length" class="text-xs text-muted text-center py-8">沒有符合的卡片</p>
      </div>
    </div>

    <!-- 右：處置 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-if="!selected" class="h-full flex flex-col items-center justify-center text-muted text-sm gap-2">
        <span class="text-4xl opacity-30">📊</span>
        從左側選擇項目，或搜尋症狀
      </div>

      <EmergencyCardPanel v-else :card="selected" />
    </div>
  </div>
</template>
