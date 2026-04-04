<script setup lang="ts">
import { ref, watch } from "vue";

export interface MedicationForm {
  id?: number;
  name: string;
  generic_name: string;
  synonyms: string;       // comma-separated in UI, stored as JSON
  category: string;
  route: string;
  dose: string;
  iv_rate: string;
  warnings: string;       // newline-separated in UI, stored as JSON
  notes: string;
}

const props = defineProps<{ modelValue: MedicationForm | null; mode: "add" | "edit" }>();
const emit = defineEmits<{ "update:modelValue": [v: MedicationForm | null]; save: [v: MedicationForm]; close: [] }>();

const form = ref<MedicationForm>(empty());

function empty(): MedicationForm {
  return { name: "", generic_name: "", synonyms: "", category: "", route: "PO", dose: "", iv_rate: "", warnings: "", notes: "" };
}

watch(() => props.modelValue, (v) => {
  if (v) form.value = { ...v };
  else form.value = empty();
}, { immediate: true });

const ROUTES = ["PO", "IV", "IM", "SC", "SL", "INH", "TOP", "PR", "EYE"];
const CATEGORIES = ["抗生素", "心臟血管", "消化系統", "神經系統", "止痛/解熱", "類固醇", "抗凝血", "降血糖", "降血壓", "精神科", "泌尿科", "其他"];

function submit() {
  if (!form.value.name.trim()) return;
  emit("save", { ...form.value });
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('close')">
    <div class="w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 class="text-white font-semibold">{{ mode === "add" ? "新增藥物" : "編輯藥物" }}</h2>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-300 cursor-pointer text-xl leading-none">×</button>
      </div>

      <!-- Form -->
      <form @submit.prevent="submit" class="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <!-- Name + Generic -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-gray-400 mb-1">藥品名稱 <span class="text-red-400">*</span></label>
            <input v-model="form.name" required class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" placeholder="品名" />
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">學名 (Generic)</label>
            <input v-model="form.generic_name" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" placeholder="學名" />
          </div>
        </div>

        <!-- Route + Category -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-gray-400 mb-1">給藥途徑</label>
            <select v-model="form.route" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500">
              <option v-for="r in ROUTES" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">分類</label>
            <select v-model="form.category" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500">
              <option value="">— 選擇 —</option>
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>

        <!-- Dose + IV Rate -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-gray-400 mb-1">劑量</label>
            <input v-model="form.dose" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" placeholder="e.g. 500mg Q8H" />
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">IV 速度</label>
            <input v-model="form.iv_rate" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" placeholder="e.g. 100mL/hr" />
          </div>
        </div>

        <!-- Synonyms -->
        <div>
          <label class="block text-xs text-gray-400 mb-1">同義詞 <span class="text-gray-600">(逗號分隔)</span></label>
          <input v-model="form.synonyms" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" placeholder="e.g. Augmentin, AMC, 安滅菌" />
        </div>

        <!-- Warnings -->
        <div>
          <label class="block text-xs text-gray-400 mb-1">防呆警示 <span class="text-gray-600">(每行一條，顯示紅字)</span></label>
          <textarea v-model="form.warnings" rows="3" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-red-500 resize-none" placeholder="腎功能不全減量&#10;QTc 延長風險，監測心電圖"></textarea>
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-xs text-gray-400 mb-1">備註</label>
          <textarea v-model="form.notes" rows="2" class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 resize-none"></textarea>
        </div>
      </form>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
        <button @click="emit('close')" class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors cursor-pointer">取消</button>
        <button @click="submit" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 transition-colors cursor-pointer">
          {{ mode === "add" ? "新增" : "儲存" }}
        </button>
      </div>
    </div>
  </div>
</template>
