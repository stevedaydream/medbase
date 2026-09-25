import { callGas, json, type GasResponse } from "./_lib/gas.js";
import { signToken, verifyToken, type TokenPayload } from "./_lib/token.js";
import {
  stateOf, docsOfPatch, planEmpSwap, opRequestSwap, opAcceptSwap, opCloseSwap,
  type DocMap, type SwapReqDoc, type EmpSwapKind, type OpPatch,
} from "./_lib/schedCore.js";

/**
 * POST /api/swap  員工自行換班（ADR-016）
 * { action: "list" }                                     我相關的換班申請
 * { action: "preview" | "create", ym, kind, b, give, take, note }
 * { action: "accept" | "reject" | "cancel", ym, id }
 *
 * 員工沒有寫班表的權限，由這裡以最新雲端文件執行共用的換班邏輯（與桌機、排班者手機相同），
 * 身分取自憑證與 GAS（schMe）；寫入用 atomic 版本比對，衝突時重讀重算。
 */

type Args = Record<string, unknown>;
type Gas = (body: Args) => Promise<GasResponse>;
interface Me { id: string; name: string; role: string }

const KINDS: EmpSwapKind[] = ["same", "cross", "cover"];
const YM = /^\d{6}$/;
const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const days = (v: unknown) => Array.isArray(v) ? v.slice(0, 31).map(Number).filter(n => Number.isInteger(n)) : [];

export class HttpError extends Error {
  constructor(public status: number, msg: string, public code?: string) { super(msg); }
}

const prevYm = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4)); return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`; };
export const taipeiToday = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10).replace(/-/g, "");

async function ok(gas: Gas, body: Args): Promise<GasResponse> {
  const r = await gas(body);
  if (!r.ok) throw new HttpError(502, r.error ?? "伺服器錯誤");
  return r;
}

/** 讀出計算需要的文件（ym 之前一個月起的月份、預班，及設定、通知、欠班、申請與紀錄） */
async function load(gas: Gas, ym: string | null): Promise<{ docs: DocMap; versions: Record<string, string> }> {
  const list = (await ok(gas, { action: "schList" })).docs as { key: string; version: string }[];
  const versions = Object.fromEntries(list.map(d => [d.key, d.version]));
  const from = ym ? prevYm(ym) : "";
  const want = list.map(d => d.key).filter(k => {
    const m = /^(month|prebook|swapreq|log):(\d{6})$/.exec(k);
    if (m) return m[1] === "log" ? m[2] === ym : m[1] === "swapreq" ? !ym || m[2] === ym : !!ym && m[2] >= from;
    return ["people", "shifts", "quotaItems", "rules", "holidays", "holidayDuty", "duty84", "cny", "debts", "notices"].includes(k);
  });
  const got = (await ok(gas, { action: "schGet", keys: want })).docs as { key: string; json: string }[];
  const docs: DocMap = {};
  for (const d of got) docs[d.key] = JSON.parse(d.json);
  return { docs, versions };
}

async function save(gas: Gas, out: DocMap, versions: Record<string, string>): Promise<boolean> {
  const items = Object.entries(out).map(([key, v]) => ({ key, json: JSON.stringify(v), base: versions[key] ?? null }));
  if (!items.length) return true;
  const r = await ok(gas, { action: "schPut", items, atomic: true });
  return !r.aborted && (r.results as { ok: boolean }[]).every(x => x.ok);
}

export async function handle(body: Args, me: Me, gas: Gas, now: Date): Promise<Args> {
  const action = str(body.action, 20);
  const nowIso = now.toISOString();
  const today = taipeiToday(now);
  const actor = `${me.name}（手機）`;

  if (action === "list") {
    const { docs } = await load(gas, null);
    const since = prevYm(today.slice(0, 6));
    const items = Object.entries(docs).filter(([k]) => k.startsWith("swapreq:") && k.slice(8) >= since)
      .flatMap(([, d]) => (d as SwapReqDoc).items).filter(r => r.a === me.id || r.b === me.id)
      .sort((x, y) => (x.at < y.at ? 1 : -1));
    return { ok: true, me: me.id, items };
  }

  const ym = str(body.ym, 6);
  if (!YM.test(ym)) throw new HttpError(400, "月份格式錯誤");
  const reqKey = `swapreq:${ym}`;

  // 最多重試 3 次（其他人同時修改時重讀重算）
  for (let attempt = 0; attempt < 3; attempt++) {
    const { docs, versions } = await load(gas, ym);
    const s = stateOf(docs);
    const reqs = (docs[reqKey] as SwapReqDoc) ?? { ym, items: [] };
    let out: DocMap = {};
    let result: Args = { ok: true };
    let published = false;

    if (action === "preview" || action === "create") {
      const kind = str(body.kind, 10) as EmpSwapKind;
      if (!KINDS.includes(kind)) throw new HttpError(400, "換班方式錯誤");
      const inp = { ym, kind, a: me.id, b: str(body.b, 64), give: days(body.give), take: days(body.take), note: str(body.note, 100).trim() };
      if (action === "preview") {
        const p = planEmpSwap(s, inp, "preview", actor, nowIso, today);
        return { ok: true, hard: p.hard, soft: p.soft, days: p.days, give: p.give, take: p.take };
      }
      const r = opRequestSwap(s, reqs, inp, actor, nowIso, today);
      if (r.plan.hard.length) return { ok: false, error: "違反硬性規則", hard: r.plan.hard, soft: r.plan.soft };
      out = docsOfPatch(docs, { months: [], prebooks: [], ests: [], warnings: [], notices: r.notices, logs: [] }, nowIso);
      out[reqKey] = r.reqs;
      result = { ok: true, req: r.req };
    } else if (action === "accept") {
      const r = opAcceptSwap(s, reqs, str(body.id, 64), me.id, actor, nowIso, today);
      out = docsOfPatch(docs, r.patch as OpPatch, nowIso);
      out[reqKey] = r.reqs;
      published = !r.error && s.months[ym]?.status === "published";
      result = r.error ? { ok: false, error: r.error } : { ok: true };
    } else if (action === "reject" || action === "cancel") {
      const r = opCloseSwap(s, reqs, str(body.id, 64), me.id, action === "reject" ? "rejected" : "cancelled", nowIso);
      out = docsOfPatch(docs, { months: [], prebooks: [], ests: [], warnings: [], notices: r.notices, logs: [] }, nowIso);
      out[reqKey] = r.reqs;
    } else {
      throw new HttpError(400, "不允許的操作");
    }

    if (await save(gas, out, versions)) {
      if (published) await gas({ action: "schPublish", ym }).catch(() => null);
      return result;
    }
  }
  throw new HttpError(409, "有人同時在修改班表，請稍後再試");
}

export async function POST(request: Request): Promise<Response> {
  const user: TokenPayload | null = await verifyToken((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!user) return json({ ok: false, code: "AUTH", error: "登入已失效，請重新登入" }, { status: 401 });
  let body: Args;
  try { body = await request.json(); } catch { return json({ ok: false, error: "格式錯誤" }, { status: 400 }); }

  try {
    // 身分：由 GAS 依 HIS 帳號查排班人員（同時檢查 HIS 密碼是否已改）
    const who = await callGas({ action: "schMe", _mobile: { his: user.his, fp: user.fp } });
    if (!who.ok && who.code === "MOBILE_AUTH") return json({ ok: false, code: "AUTH", error: "登入已失效，請重新登入" }, { status: 401 });
    const me = who.person as Me | null;
    if (!who.ok || !me) return json({ ok: false, error: "你不在排班名單中" }, { status: 403 });

    const out = await handle(body, me, callGas, new Date());
    const { exp: _exp, ...rest } = user;
    return json(out, { headers: { "x-token": await signToken(rest) } });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, { status: e.status });
    // planEmpSwap 的輸入檢查（例如日期已過、月份排班中）
    if (e instanceof Error && !/fetch|GAS|ECONN/i.test(e.message)) return json({ ok: false, error: e.message }, { status: 400 });
    console.error("[swap]", e);
    return json({ ok: false, code: "UPSTREAM", error: "伺服器暫時無法連線，請稍後再試" }, { status: 502 });
  }
}
