<script setup lang="ts">
import { ref, watch } from "vue";
import { dbWrite } from "@/db";
import { touchTable } from "@/composables/useTableSync";
import ComboInput from "@/components/ComboInput.vue";

/**
 * 自費品項詳細新增／編輯（資料管理頁、套組加入品項共用）。
 * 存檔後 emit saved(院內碼)；院內碼已存在時新增會被略過並提示。
 */
export interface ItemFormValue {
  hospital_code: string; name_en: string | null; name_zh: string | null; purpose: string | null;
  unit: string | null; price: number | null; supplier: string | null; notes: string | null; depts: string[];
}

const props = defineProps<{
  open: boolean;
  mode: "add" | "edit";
  item?: Partial<ItemFormValue> | null;
  /** 既有用途分類（下拉選單） */
  purposes: string[];
  /** 既有院內碼：新增時檢查重複 */
  existingCodes?: Set<string>;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved", code: string): void;
  (e: "error", msg: string): void;
}>();

const form = ref<Partial<ItemFormValue>>({});
const deptsText = ref("");
const saving = ref(false);
const err = ref("");

watch(() => props.open, o => {
  if (!o) return;
  form.value = { ...(props.item ?? {}) };
  deptsText.value = (props.item?.depts ?? []).join(";");
  err.value = "";
}, { immediate: true });

async function save() {
  const f = form.value;
  const code = f.hospital_code?.trim();
  if (!code) { err.value = "請輸入院內碼"; return; }
  if (props.mode === "add" && props.existingCodes?.has(code)) { err.value = `院內碼 ${code} 已存在`; return; }
  saving.value = true;
  try {
    const vals = [f.name_en || null, f.name_zh || null, f.purpose?.trim() || null, f.unit || null,
      f.price ?? null, f.supplier || null, f.notes || null];
    if (props.mode === "add") {
      await dbWrite(
        `INSERT OR IGNORE INTO items (hospital_code,name_en,name_zh,purpose,unit,price,supplier,notes) VALUES (?,?,?,?,?,?,?,?)`,
        [code, ...vals]);
    } else {
      await dbWrite(
        `UPDATE items SET name_en=?,name_zh=?,purpose=?,unit=?,price=?,supplier=?,notes=? WHERE hospital_code=?`,
        [...vals, code]);
    }
    const depts = deptsText.value.split(";").map(s => s.trim()).filter(Boolean);
    await dbWrite("DELETE FROM item_depts WHERE hospital_code=?", [code]);
    for (const d of depts) await dbWrite("INSERT OR IGNORE INTO item_depts (hospital_code,dept) VALUES (?,?)", [code, d]);
    await touchTable("items");
    emit("saved", code);
  } catch (e) {
    err.value = `儲存失敗：${(e as Error).message}`;
    emit("error", err.value);
  } finally {
    saving.value = false;
  }
}

const field = "w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50";
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[9100] flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="emit('close')">
      <div class="w-full max-w-lg bg-surface rounded-2xl border border-hairline shadow-2xl overflow-hidden text-fg">
        <div class="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h3 class="font-bold text-fg text-sm">{{ mode === "add" ? "新增" : "編輯" }}品項</h3>
          <button @click="emit('close')" class="text-muted hover:text-fg-secondary text-lg leading-none cursor-pointer">✕</button>
        </div>
        <div class="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-xs font-bold text-muted mb-1 block">院內碼 *</label>
              <input v-model="form.hospital_code" :disabled="mode === 'edit'" placeholder="M1A01234"
                :class="field" class="font-mono font-bold disabled:opacity-40 disabled:cursor-not-allowed" />
            </div>
            <div>
              <label class="text-xs font-bold text-muted mb-1 block">計價單位</label>
              <input v-model="form.unit" placeholder="個 / 支 / 組" :class="field" />
            </div>
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">中文品名</label>
            <input v-model="form.name_zh" placeholder="請輸入中文品名..." :class="field" class="font-bold" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">英文品名</label>
            <input v-model="form.name_en" placeholder="English Name / Description..." :class="field" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">耗材用途分類（可選既有分類或輸入新分類）</label>
            <ComboInput v-model="form.purpose" :options="purposes" add-label="新增類別"
              placeholder="例如：止血劑 / Mesh人工網膜 / 骨釘" :input-class="`${field} font-bold`" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">適用科別（多科請用分號分隔，如：骨科;一般外科）</label>
            <input v-model="deptsText" placeholder="骨科;一般外科;心臟外科" :class="field" class="font-bold" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-xs font-bold text-muted mb-1 block">自費金額 (NTD)</label>
              <input v-model.number="form.price" type="number" placeholder="0" :class="field" class="font-mono font-bold" />
            </div>
            <div>
              <label class="text-xs font-bold text-muted mb-1 block">材料廠商名稱</label>
              <input v-model="form.supplier" placeholder="進口商或供應商" :class="field" />
            </div>
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">備註資訊</label>
            <textarea v-model="form.notes" rows="2" :class="field" class="resize-none leading-relaxed" />
          </div>
          <p v-if="err" class="text-xs text-danger font-bold">{{ err }}</p>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-hairline bg-surface">
          <button @click="emit('close')" class="px-4 py-2 rounded-xl text-xs font-bold text-fg-secondary hover:text-fg hover:bg-overlay/5 cursor-pointer transition-colors">取消</button>
          <button @click="save" :disabled="saving"
            class="px-5 py-2 rounded-xl bg-accent border border-accent/30 hover:bg-accent text-white text-xs font-bold cursor-pointer shadow-lg shadow-accent/10 disabled:opacity-40">
            {{ saving ? "儲存中…" : "儲存品項" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
