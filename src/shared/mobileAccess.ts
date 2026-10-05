/**
 * 手機依身分區分功能（ADR-026）。
 * 身分由通訊錄職稱對應；管理者（通訊錄「手機管理者」）看得到全部並可調整權限表。
 * GAS（gas/scheduler.gs 的 MOBILE_*）有同樣一份規則，修改時兩邊一起改（測試會比對）。
 */
export type Identity = "doctor" | "np" | "nurse" | "other";
/** 權限表只有這三欄；「其他」比照護理師 */
export type MatrixIdentity = Exclude<Identity, "other">;

export const IDENTITY_LABELS: Record<Identity, string> = {
  doctor: "醫師", np: "專科護理師", nurse: "護理師", other: "其他",
};
export const MATRIX_IDENTITIES: MatrixIdentity[] = ["doctor", "np", "nurse"];

export interface FeatureDef {
  key: string;
  label: string;
  /** 伺服器依此擋 readTable 的資料表 */
  tables: string[];
}

export const FEATURES = [
  { key: "sets", label: "套組", tables: ["prescriptions", "surgery", "examination", "disease", "sets", "surgeryTypes"] },
  { key: "contacts", label: "通訊錄", tables: ["physicians", "contacts"] },
  { key: "contactSecrets", label: "通訊錄密碼", tables: [] },
  { key: "items", label: "自費品項", tables: ["items"] },
  { key: "memos", label: "規則備忘錄", tables: ["shiftMemos"] },
  { key: "care", label: "處置及臨床工具", tables: ["emergency", "handbook"] },
  { key: "npDuty", label: "NP 值班表", tables: [] },
  { key: "aiDocs", label: "AI 文件", tables: [] },
  { key: "research", label: "論文專案", tables: [] },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type AccessMatrix = Record<MatrixIdentity, FeatureKey[]>;

export const FEATURE_KEYS = FEATURES.map(f => f.key) as FeatureKey[];

export const DEFAULT_ACCESS: AccessMatrix = {
  doctor: [...FEATURE_KEYS],
  np: [...FEATURE_KEYS],
  nurse: ["contacts", "memos", "care", "npDuty"],
};

/** 登入者的手機權限（伺服器回傳） */
export interface MobileAccess { identity: Identity; admin: boolean; features: FeatureKey[] }

/** 職稱 → 身分（「專科護理師」含「護理」，要先判斷） */
export function identityOf(title: string | null | undefined): Identity {
  const t = String(title ?? "");
  if (t.includes("專科護理")) return "np";
  if (t.includes("醫師")) return "doctor";
  if (t.includes("護理")) return "nurse";
  return "other";
}

/** 清理權限表：不認得的鍵丟掉，缺的身分用預設值 */
export function normalizeMatrix(raw: unknown): AccessMatrix {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as AccessMatrix;
  for (const id of MATRIX_IDENTITIES) {
    const v = src[id];
    out[id] = Array.isArray(v) ? FEATURE_KEYS.filter(k => v.includes(k)) : [...DEFAULT_ACCESS[id]];
  }
  return out;
}

export function featuresOf(identity: Identity, admin: boolean, matrix: AccessMatrix): FeatureKey[] {
  if (admin) return [...FEATURE_KEYS];
  return [...matrix[identity === "other" ? "nurse" : identity]];
}

/** 資料表屬於哪個權限單位（不屬於任何單位回傳 null） */
export function featureOfTable(table: string): FeatureKey | null {
  return FEATURES.find(f => (f.tables as readonly string[]).includes(table))?.key ?? null;
}
