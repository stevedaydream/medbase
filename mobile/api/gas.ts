import { callGas, json } from "./_lib/gas.js";
import { signToken, verifyToken, type TokenPayload } from "./_lib/token.js";

/**
 * POST /api/gas  { action, ...args }  （Authorization: Bearer <token>）
 *
 * 手機唯一的資料入口（ADR-013）：驗證憑證後代為呼叫 GAS。
 * - 只允許白名單內的 action，參數逐一挑選，不接受任意欄位（例如 getSchedule 的 spreadsheetId）
 * - 身分一律取自憑證：排班身分與角色由 GAS 依 HIS 帳號查 people 決定、論文的 HIS 帳號不信任手機送來的值
 * - 成功時於 x-token 回傳換發的新憑證（30 天滑動延長）
 */

type Args = Record<string, unknown>;
interface Rule {
  /** 從手機參數挑出要轉給 GAS 的欄位；回傳 Response 代表拒絕 */
  build: (a: Args, user: TokenPayload) => Args | Response;
  /** 過濾 GAS 回應 */
  filter?: (r: Record<string, unknown>) => Record<string, unknown>;
}

const READ_TABLES = new Set([
  "physicians", "contacts", "prescriptions", "surgery", "examination", "disease",
  "shiftMemos", "items", "sets", "surgeryTypes",
]);

const CONFIG_KEYS = ["np_duty_url"];

/** 排班文件 key：people／shifts…／month:YYYYMM／prebook:YYYYMM／log:global… */
const SCH_KEY = /^(people|shifts|quotaItems|rules|holidays|holidayDuty|duty84|cny|notices|debts|(month|prebook|log|lock|est):(\d{6}|global))$/;
const MAX_DOC = 2_000_000;

const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const forbidden = (msg: string) => json({ ok: false, error: msg }, { status: 403 });

export const RULES: Record<string, Rule> = {
  getVersions:       { build: () => ({}) },
  getConfig: {
    build: () => ({}),
    filter: (r) => {
      const data = (r.data ?? {}) as Record<string, string>;
      return { ...r, data: Object.fromEntries(CONFIG_KEYS.filter(k => k in data).map(k => [k, data[k]])) };
    },
  },
  getSchedule: {
    build: (a) => /^Schedule_\d{6}$/.test(str(a.sheetName)) ? { sheetName: str(a.sheetName) } : forbidden("班表名稱格式錯誤"),
  },
  // 排班 v3（ADR-015）：角色與可讀寫範圍由 GAS 依 HIS 帳號判斷，這裡只檢查格式
  schMe:   { build: () => ({}) },
  schList: { build: () => ({}) },
  schGet: {
    build: (a) => {
      const keys = Array.isArray(a.keys) ? (a.keys as unknown[]).map(k => str(k, 40)) : [];
      return keys.length && keys.length <= 300 && keys.every(k => SCH_KEY.test(k)) ? { keys } : forbidden("文件名稱錯誤");
    },
  },
  schPut: {
    build: (a) => {
      const items = Array.isArray(a.items) ? (a.items as Args[]) : [];
      if (!items.length || items.length > 60) return forbidden("文件數量錯誤");
      const out = [];
      for (const it of items) {
        const key = str(it?.key, 40);
        if (!SCH_KEY.test(key) || typeof it?.json !== "string" || it.json.length > MAX_DOC) return forbidden("文件格式錯誤");
        out.push({ key, json: it.json, base: it.base == null ? null : str(it.base, 40) });
      }
      return { items: out };
    },
  },
  mobileSetPrebook: {
    build: (a) => {
      if (!/^\d{6}$/.test(str(a.ym)) || !Array.isArray(a.cells) || a.cells.length > 31) return forbidden("預班格式錯誤");
      const cells = (a.cells as Args[]).map(c => ({ day: Number(c?.day), v: c?.v ? str(c.v, 10) : null }));
      return { ym: str(a.ym), cells };
    },
  },
  mobileMarkRead: {
    build: (a) => ({ ids: Array.isArray(a.ids) ? (a.ids as unknown[]).slice(0, 500).map(x => str(x, 40)) : null }),
  },
  readTable: {
    build: (a) => READ_TABLES.has(str(a.table)) ? { table: str(a.table) } : forbidden("不允許讀取此資料表"),
  },
  getNpDutyVersions: { build: () => ({}) },
  getNpDutyMonths: {
    build: (a) => {
      const months = Array.isArray(a.months) ? (a.months as unknown[]).map(m => str(m, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)).slice(0, 6) : [];
      return months.length ? { months } : forbidden("月份格式錯誤");
    },
  },
  // 論文專案：仍需 PIN（ADR-012），HIS 帳號取自憑證
  researchLogin: {
    build: (a, u) => ({ his: u.his, pin: str(a.pin, 6) }),
  },
  researchListBackups: {
    build: (a, u) => ({ his: u.his, token: str(a.researchToken, 64) }),
  },
  researchGetBackup: {
    build: (a, u) => /^\d{4}-\d{2}-\d{2}$/.test(str(a.day)) ? { his: u.his, token: str(a.researchToken, 64), day: str(a.day) } : forbidden("日期格式錯誤"),
  },
};

export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const user = await verifyToken(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ ok: false, code: "AUTH", error: "登入已失效，請重新登入" }, { status: 401 });

  let body: Args;
  try { body = await request.json(); } catch { return json({ ok: false, error: "格式錯誤" }, { status: 400 }); }
  const action = str(body.action, 64);
  const rule = RULES[action];
  if (!rule) return forbidden("不允許的操作");

  const args = rule.build(body, user);
  if (args instanceof Response) return args;

  try {
    const r = await callGas({ action, ...args, _mobile: { his: user.his, fp: user.fp } });
    // 手機登入失效（HIS 密碼已改）→ 401 讓手機回到登入頁；
    // 論文 PIN 憑證過期的 AUTH 不在此列，交給論文頁處理
    if (!r.ok && r.code === "MOBILE_AUTH") {
      return json({ ok: false, code: "AUTH", error: "登入已失效，請重新登入" }, { status: 401 });
    }
    // Vercel 上的 GAS_API_KEY 與 GAS 不符：伺服器設定問題，不該把使用者登出
    if (!r.ok && r.code === "UNAUTHORIZED") {
      console.error("[gas] GAS 拒絕金鑰，請檢查 Vercel 環境變數 GAS_API_KEY");
      return json({ ok: false, code: "UPSTREAM", error: "伺服器設定錯誤，請聯絡管理者" }, { status: 502 });
    }
    const out = rule.filter ? rule.filter(r) : r;
    const { exp: _exp, ...rest } = user;
    return json(out, { headers: { "x-token": await signToken(rest) } });
  } catch (e) {
    console.error("[gas]", action, e);
    return json({ ok: false, code: "UPSTREAM", error: "伺服器暫時無法連線，請稍後再試" }, { status: 502 });
  }
}
