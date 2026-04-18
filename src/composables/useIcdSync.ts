import { ref } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";

// 模組層級 state：路由切換後仍存活
export const icdSyncing  = ref(false);
export const icdProgress = ref(0);
export const icdTotal    = ref(0);
export const icdMessage  = ref("");

export async function pullIcdFromCloud(): Promise<void> {
  const cloud = useCloudSettings();
  if (!cloud.gasUrl) {
    icdMessage.value = "請先在「設定」頁面填入 GAS Web App URL";
    return;
  }

  icdSyncing.value  = true;
  icdProgress.value = 0;
  icdTotal.value    = 0;
  icdMessage.value  = "ICD 雲端同步中…";

  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getIcdCodes" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");

    const data: { code: string; version: string; description_zh: string; description_en: string; category: string }[] = json.data;
    if (!data.length) {
      icdMessage.value = "雲端無 ICD 資料";
      return;
    }

    icdTotal.value = data.length;
    const db = await getDb();
    await db.execute("DELETE FROM icd_codes");

    const BATCH = 200;
    for (let i = 0; i < data.length; i += BATCH) {
      const slice = data.slice(i, i + BATCH);
      for (const r of slice) {
        await db.execute(
          "INSERT INTO icd_codes (code, version, description_zh, description_en, category) VALUES (?,?,?,?,?)",
          [r.code, r.version || "ICD10", r.description_zh, r.description_en, r.category]
        );
      }
      icdProgress.value = Math.min(i + BATCH, data.length);
      // 讓 UI 有機會更新
      await new Promise(r => setTimeout(r, 0));
    }

    icdMessage.value = `已同步 ${data.length.toLocaleString()} 筆 ICD 代碼`;
  } catch (e) {
    icdMessage.value = `下載失敗：${(e as Error).message}`;
  } finally {
    icdSyncing.value = false;
  }
}
