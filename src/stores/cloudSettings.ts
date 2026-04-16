import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getDb } from "@/db";

export const useCloudSettings = defineStore("cloudSettings", () => {
  const spreadsheetId         = ref("");
  const apiKey                = ref("");
  const gasUrl                = ref("");
  const scheduleSpreadsheetId = ref("");   // 班表專用試算表 ID（可與主表不同）
  const loaded                = ref(false);

  async function load() {
    if (loaded.value) return;
    try {
      const db   = await getDb();
      const rows = await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?)",
        ["scheduler_spreadsheet_id", "scheduler_api_key", "scheduler_gas_url", "schedule_spreadsheet_id"]
      );
      for (const r of rows) {
        if (r.key === "scheduler_spreadsheet_id") spreadsheetId.value         = r.value;
        if (r.key === "scheduler_api_key")         apiKey.value                = r.value;
        if (r.key === "scheduler_gas_url")          gasUrl.value                = r.value;
        if (r.key === "schedule_spreadsheet_id")   scheduleSpreadsheetId.value = r.value;
      }
    } catch { /* first launch */ }
    loaded.value = true;
  }

  async function persist() {
    const db = await getDb();
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_spreadsheet_id", spreadsheetId.value]);
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_api_key",         apiKey.value]);
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_gas_url",          gasUrl.value]);
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["schedule_spreadsheet_id",   scheduleSpreadsheetId.value]);
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  watch([spreadsheetId, apiKey, gasUrl, scheduleSpreadsheetId], () => {
    if (!loaded.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 800);
  });

  async function reload() {
    loaded.value = false;
    await load();
  }

  return { spreadsheetId, apiKey, gasUrl, scheduleSpreadsheetId, loaded, load, reload };
});
