export interface SeedPhysician {
  name: string;
  department: string | null;
  title: string | null;
  ext: string | null;
  his_account: string | null;
  his_password: string | null;
  phs_account: string | null;
  phs_password: string | null;
  notes: string | null;
}

export interface SeedContact {
  label: string;
  ext: string;
  category: string;
  notes: string | null;
}

// ── 醫師通訊錄預設資料 ──────────────────────────────────────────────
// 每次全新安裝（physicians 表為空時）自動匯入
export const seedPhysicians: SeedPhysician[] = [
  // 範例：
  // { name: "王大明", department: "一般外科", title: "主治醫師", ext: "1234", his_account: "wang", his_password: "pw123", phs_account: "", phs_password: "", notes: null },
];

// ── 常用分機預設資料 ────────────────────────────────────────────────
// 每次全新安裝（contacts 表為空時）自動匯入
export const seedContacts: SeedContact[] = [
  // 範例：
  // { label: "急診護理站", ext: "1000", category: "急診", notes: null },
  // { label: "手術室控台", ext: "2000", category: "手術室", notes: null },
];
