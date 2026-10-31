import { callGas, json, type GasResponse } from "./_lib/gas.js";
import { verifyLinkCode } from "./_lib/linkCode.js";

/**
 * POST /api/bot  { action, ...args }  （Authorization: Bearer <BOT_API_KEY>）
 *
 * 醫院群組助手 LINE bot 專用的唯讀入口：提供已發布班表、班表版本、綁定碼兌換與主治名單。
 * 主治名單只回姓名、科別與職稱，不回傳帳密、分機或通訊錄其他欄位。
 * 金鑰只存在 Vercel（BOT_API_KEY）與 bot 的 .env。
 *
 * { action: "day", date: "YYYY-MM-DD", group? }          該日已發布班表 → items: [{ name, shift }]
 * { action: "person", his, from: "YYYY-MM-DD", to }      某人區間內的班（最多 31 天）
 * { action: "duty", date: "YYYY-MM-DD" }                 NP／VS 值班表（NpDuty）該日 → items: [{ ward, shift, name, extension, his? }]（his 只有 VS 總值）
 * { action: "versions", group? }                          已發布班表分頁版本（bot 偵測發布）
 * { action: "redeem", code }                              兌換綁定碼 → { his, name, group }
 * { action: "attendingRoster" }                          通訊錄主治醫師 → items: [{ name, department, title }]
 * { action: "items", his, query, offset? }               依綁定帳號權限查詢自費品項，每頁 5 筆
 */

type Args = Record<string, unknown>;
type Gas = (body: Args) => Promise<GasResponse>;

export const DEFAULT_GROUP = "9A9B";
const GROUP_ID = /^[A-Za-z0-9]{1,12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);

export class BotError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

interface PersonRow { id: string; name: string; his: string; group?: string; unit?: string; active: boolean }

/** 同 src/shared/sched/groups.ts personGroup()：沒有群組欄位的舊資料，9A／9B 視為預設群組 */
const personGroup = (p: { group?: string; unit?: string }) =>
  p.group !== undefined ? p.group : /^9[AB]$/i.test((p.unit ?? "").trim()) ? DEFAULT_GROUP : "";

const groupOf = (a: Args) => {
  const g = str(a.group, 12);
  if (!g) return DEFAULT_GROUP;
  if (!GROUP_ID.test(g)) throw new BotError(400, "群組代碼錯誤");
  return g;
};

function parseDate(v: unknown): Date {
  const s = str(v, 10);
  const d = new Date(`${s}T00:00:00Z`);
  if (!DATE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new BotError(400, "日期格式錯誤");
  return d;
}

const ymOf = (d: Date) => d.toISOString().slice(0, 7).replace("-", "");
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** 已發布班表（姓名, 1日…31日）；尚未發布回 null */
async function readSchedule(gas: Gas, group: string, ym: string): Promise<string[][] | null> {
  const r = await gas({ action: "getSchedule", sheetName: `Schedule_${ym}`, group });
  if (!r.ok) {
    if (/不存在/.test(r.error ?? "")) return null;
    throw new BotError(502, r.error ?? "讀取班表失敗");
  }
  return ((r.data as string[][]) ?? []).slice(1);
}

async function readPeople(gas: Gas): Promise<PersonRow[]> {
  const r = await gas({ action: "schGet", keys: ["people"] });
  if (!r.ok) throw new BotError(502, r.error ?? "讀取人員失敗");
  const doc = ((r.docs as { key: string; json: string }[]) ?? []).find(d => d.key === "people");
  try { return doc ? (JSON.parse(doc.json) as PersonRow[]) : []; } catch { return []; }
}

const VS_PRIMARY = "總值";
const normName = (name: string) => name.replace(/\s+/g, "");

/** 通訊錄姓名 → HIS 帳號；讀不到時回空表，值班表照常回傳 */
async function hisByName(gas: Gas): Promise<Map<string, string>> {
  const r = await gas({ action: "readTable", table: "physicians" });
  if (!r.ok) return new Map();
  const rows = (r.rows as { name?: string; his_account?: string }[]) ?? [];
  return new Map(rows.filter(p => p.name && p.his_account?.trim()).map(p => [normName(String(p.name)), String(p.his_account).trim()]));
}

async function findPerson(gas: Gas, his: string) {
  const p = (await readPeople(gas)).find(x => x.active && String(x.his ?? "").trim() === his);
  return p ? { his, name: p.name, group: personGroup(p) } : null;
}

export async function handleBot(body: Args, gas: Gas, now = Date.now()): Promise<Args> {
  const action = str(body.action, 20);

  if (action === "items") {
    const his = str(body.his, 64).trim();
    const query = String(body.query ?? "").trim();
    const offset = body.offset ?? 0;
    if (!his || !query || query.length > 100 || !Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 10000) throw new BotError(400, "請提供 1～100 字的關鍵字與有效頁碼");
    const r = await gas({ action: "botItems", his, query, offset });
    if (!r.ok) throw new BotError(r.code === "FORBIDDEN" ? 403 : 502,
      r.code === "FORBIDDEN" ? "你的 MedBase 帳號沒有自費品項查詢權限" : "自費查詢暫時無法使用，請確認 GAS 已更新或稍後再試");
    if (!Array.isArray(r.items) || !Number.isInteger(r.total) || Number(r.total) < 0) throw new BotError(502, "自費查詢資料格式錯誤");
    return { ok: true, total: r.total, offset, items: (r.items as Args[]).slice(0, 5).map(p => {
      if (!p || typeof p !== "object") throw new BotError(502, "自費品項格式錯誤");
      const code = String(p.hospital_code ?? "");
      const nameZh = String(p.name_zh ?? ""), nameEn = String(p.name_en ?? "");
      if (!code.trim() || code.length > 100 || nameZh.length > 500 || nameEn.length > 500) throw new BotError(502, "自費品名或院內碼格式錯誤");
      return {
        hospital_code: code, name_zh: nameZh, name_en: nameEn,
        price: typeof p.price === "number" && Number.isFinite(p.price) && p.price >= 0 ? p.price : null,
        unit: str(p.unit, 40), depts: Array.isArray(p.depts) ? p.depts.map(d => str(d, 40)).slice(0, 10) : []
      };
    }) };
  }

  if (action === "attendingRoster") {
    const r = await gas({ action: "readTable", table: "physicians" });
    if (!r.ok) throw new BotError(502, "讀取主治醫師名單失敗");
    if (!Array.isArray(r.rows)) throw new BotError(502, "主治醫師名單格式錯誤");
    const seen = new Set<string>();
    const items = (r.rows as Args[]).flatMap(p => {
      if (!p || typeof p !== "object") return [];
      const name = str(p.name, 80).replace(/\s+/g, "");
      const department = str(p.department, 80).trim();
      const title = str(p.title, 80).trim();
      if (!name || !(/主治/.test(title) || /^VS$/i.test(title))) return [];
      const key = JSON.stringify([name, department]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ name, department, title }];
    }).sort((a, b) => a.department.localeCompare(b.department, "zh-TW") || a.name.localeCompare(b.name, "zh-TW"));
    return { ok: true, items };
  }

  if (action === "day") {
    const date = parseDate(body.date);
    const group = groupOf(body);
    const rows = await readSchedule(gas, group, ymOf(date));
    if (!rows) return { ok: true, date: isoDay(date), group, published: false, items: [] };
    const col = date.getUTCDate();
    const items = rows
      .filter(r => r[0] && r[col])
      .map(r => ({ name: String(r[0]), shift: String(r[col]) }));
    return { ok: true, date: isoDay(date), group, published: true, items };
  }

  if (action === "person") {
    const his = str(body.his, 64).trim();
    if (!his) throw new BotError(400, "缺少 HIS 帳號");
    const from = parseDate(body.from);
    const to = parseDate(body.to);
    const span = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (span < 1 || span > MAX_DAYS) throw new BotError(400, `日期區間需為 1～${MAX_DAYS} 天`);

    const person = await findPerson(gas, his);
    if (!person || !person.group) return { ok: true, found: false, days: [] };

    const schedules = new Map<string, string[][] | null>();
    const days: Args[] = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(from.getTime() + i * 86400000);
      const ym = ymOf(d);
      if (!schedules.has(ym)) schedules.set(ym, await readSchedule(gas, person.group, ym));
      const rows = schedules.get(ym);
      const row = rows?.find(r => String(r[0]).trim() === person.name);
      days.push({ date: isoDay(d), published: !!rows, shift: row?.[d.getUTCDate()] ? String(row[d.getUTCDate()]) : "" });
    }
    return { ok: true, found: true, name: person.name, group: person.group, days };
  }

  if (action === "duty") {
    // NP／VS 值班表（首頁 DutyCard 同一份資料），不分排班群組
    const date = isoDay(parseDate(body.date));
    const month = date.slice(0, 7);
    const [r, his] = await Promise.all([gas({ action: "getNpDutyMonths", months: [month] }), hisByName(gas)]);
    if (!r.ok) throw new BotError(502, r.error ?? "讀取值班表失敗");
    const rows = ((r.data as Record<string, { rows: Record<string, string>[] }>)?.[month]?.rows) ?? [];
    const items = rows
      .filter(x => String(x.duty_date).slice(0, 10) === date && x.np_name)
      .map(x => {
        const name = String(x.np_name);
        // 只附 VS 總值的 HIS 帳號（同首頁 DutyCard），不外流其他通訊錄欄位
        const vsHis = x.ward === VS_PRIMARY ? his.get(normName(name)) : undefined;
        return { ward: String(x.ward), shift: String(x.shift), name, extension: String(x.extension ?? ""), ...(vsHis ? { his: vsHis } : {}) };
      });
    return { ok: true, date, items };
  }

  if (action === "versions") {
    const group = groupOf(body);
    const r = await gas({ action: "schList", group });
    if (!r.ok) throw new BotError(502, r.error ?? "讀取版本失敗");
    return { ok: true, group, sheets: r.sheets ?? {} };
  }

  if (action === "redeem") {
    const his = await verifyLinkCode(str(body.code, 400), now);
    if (!his) throw new BotError(400, "綁定碼無效或已過期，請在 MedBase 重新取得");
    let person = await findPerson(gas, his);
    if (!person) {
      const r = await gas({ action: "readTable", table: "physicians" });
      if (!r.ok) throw new BotError(502, "讀取綁定人員失敗");
      if (!Array.isArray(r.rows)) throw new BotError(502, "綁定人員資料格式錯誤");
      const row = (r.rows as Args[]).find(p => p && String(p.his_account ?? "").trim() === his);
      if (row && String(row.name ?? "").trim()) person = { his, name: String(row.name), group: "" };
    }
    if (!person) throw new BotError(404, "你不在排班名單或 MedBase 通訊錄中，無法綁定");
    return { ok: true, ...person };
  }

  throw new BotError(400, "不允許的操作");
}

function keyMatches(supplied: string): boolean {
  const key = process.env.BOT_API_KEY;
  if (!key || key.length < 32) return false;
  const a = new TextEncoder().encode(supplied);
  const b = new TextEncoder().encode(key);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function POST(request: Request): Promise<Response> {
  if (!keyMatches((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""))) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Args;
  try { body = await request.json(); } catch { return json({ ok: false, error: "格式錯誤" }, { status: 400 }); }

  try {
    return json(await handleBot(body, callGas));
  } catch (e) {
    if (e instanceof BotError) return json({ ok: false, error: e.message }, { status: e.status });
    console.error("[bot]", e);
    return json({ ok: false, error: "伺服器暫時無法連線，請稍後再試" }, { status: 502 });
  }
}
