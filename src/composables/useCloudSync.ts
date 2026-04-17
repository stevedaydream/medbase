import { ref, computed, type Ref, type ComputedRef } from "vue";

const SYNC_META: Record<string, { label: string; route: string }> = {
  physicians:    { label: "通訊錄",     route: "/physicians" },
  sets:          { label: "套組管理",   route: "/sets" },
  surgery:       { label: "手術處置",   route: "/surgery" },
  shiftMemos:    { label: "規則備忘錄", route: "/shift-memos" },
  ahk:           { label: "AHK 管理",   route: "/ahk" },
  prescriptions: { label: "處方套組",   route: "/prescriptions" },
  items:         { label: "自費品項",   route: "/items" },
  medications:   { label: "藥物字典",   route: "/medications" },
  examination:   { label: "檢查處置",   route: "/examination" },
  disease:       { label: "疾病常規",   route: "/disease" },
  contacts:      { label: "常用分機",   route: "/contacts" },
};

const syncingRecord = ref<Record<string, boolean>>({});

export function setGlobalSyncing(key: string, active: boolean) {
  syncingRecord.value = { ...syncingRecord.value, [key]: active };
}

export function useActiveSyncBanners(routePath: Ref<string> | ComputedRef<string>) {
  return computed(() =>
    Object.entries(syncingRecord.value)
      .filter(([k, v]) => v && SYNC_META[k]?.route !== routePath.value)
      .map(([k]) => SYNC_META[k]?.label ?? k)
  );
}
