/**
 * 排班群組（ADR-025）：各病房群組獨立排班，班表互相隔離。
 * - 預設群組（9A9B）沿用舊文件 key；其他群組的群組文件加前綴「群組/」，例：8A/month:202611
 * - 共用文件（人員主檔、群組清單、國定假日、8-4、春節、通知）全院一份
 * GAS（gas/scheduler.gs）有同樣的規則，修改時兩邊一起改。
 */
import type { OpPatch } from "./ops";

export interface SchedGroup { id: string; name: string; order: number }

export const DEFAULT_GROUP = "9A9B";
export const DEFAULT_GROUPS: SchedGroup[] = [{ id: DEFAULT_GROUP, name: "9A／9B", order: 0 }];

/** 全院共用的文件 */
export const SHARED_KEYS = ["people", "groups", "holidays", "duty84", "cny", "notices"] as const;
/** 只有 super 可以寫的共用文件（notices 由各群組的流程寫入，伺服器逐筆合併） */
export const SUPER_ONLY_KEYS = ["people", "groups", "holidays", "duty84", "cny"] as const;

/** 桌機寫入雲端時帶的版本；GAS 拒絕沒帶（不認得群組）的舊版桌機寫入 */
export const SCHED_CLIENT_SCHEMA = 2;

/** 群組 id：英數字（會放進文件 key 與 Schedule_ 分頁名稱） */
export const GROUP_ID = /^[A-Za-z0-9]{1,12}$/;

export const isSharedKey = (base: string) => (SHARED_KEYS as readonly string[]).includes(base);
export const isSuperOnlyKey = (base: string) => (SUPER_ONLY_KEYS as readonly string[]).includes(base);

/** 群組內的文件名稱 → 實際儲存的 key */
export function groupKey(group: string, base: string): string {
  return isSharedKey(base) || group === DEFAULT_GROUP ? base : `${group}/${base}`;
}

/** 實際儲存的 key → 群組（共用文件為 null）與群組內的名稱 */
export function splitKey(key: string): { group: string | null; base: string } {
  const i = key.indexOf("/");
  if (i > 0) return { group: key.slice(0, i), base: key.slice(i + 1) };
  return { group: isSharedKey(key) ? null : DEFAULT_GROUP, base: key };
}

/** 已發布班表分頁名稱 */
export function scheduleSheetName(group: string, ym: string): string {
  return group === DEFAULT_GROUP ? `Schedule_${ym}` : `Schedule_${group}_${ym}`;
}

/** 人員所屬群組：尚未設定群組欄位的舊資料，9A／9B 視為預設群組，其他為未分組 */
export function personGroup(p: { group?: string; unit?: string }): string {
  if (p.group !== undefined) return p.group;
  return /^9[AB]$/i.test((p.unit ?? "").trim()) ? DEFAULT_GROUP : "";
}

/** 群組清單（雲端尚無 groups 文件時只有預設群組），依順序排列 */
export function groupList(doc: SchedGroup[] | null | undefined): SchedGroup[] {
  const list = doc?.length ? [...doc] : [...DEFAULT_GROUPS];
  if (!list.some(g => g.id === DEFAULT_GROUP)) list.unshift(DEFAULT_GROUPS[0]);
  return list.sort((a, b) => a.order - b.order);
}

/**
 * 非 super 的操作不寫共用的 8-4／春節（ADR-025）：引擎每次都會依人員與假日重新算出同樣的結果並用於預填，
 * 只有 super 的操作才存回。回傳去掉 duty84／cny 的 patch，以及是否與雲端不同（需 super 重新計算）。
 */
export function stripSharedRota(p: OpPatch): { patch: OpPatch; changed: boolean } {
  const changed = !!(p.duty84 || p.cny);
  const { duty84: _d, cny: _c, ...rest } = p;
  return { patch: rest as OpPatch, changed };
}
