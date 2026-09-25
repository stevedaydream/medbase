/**
 * 員工自行換班（ADR-016）：A 提出、B 同意即生效；硬性規則擋下，其餘只警告並記錄。
 * 純函式，由伺服器（mobile/api/swap.ts）以最新的雲端文件執行，桌機與手機排班者看到的是結果。
 *
 * give：A 的班交給 B 的日子；take：B 的班交給 A 的日子。
 * - 已發布月份：give ∪ take 每一天都是 A、B 同日對調（SwapRec，req 綁同一張申請），並立即結算欠班
 * - 開放預班：只換系統預填；give 為 A 的預填改由 B 上、take 為 B 的預填改由 A 上（PrefillSwap）
 */
import type { MonthDoc, PrebookDoc, Person, PrefillSwap, SwapRec, NoticeItem, LogDoc } from "./types";
import { clone, newId, cellKey, DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES } from "./types";
import { daysIn, prevYm, ymParts } from "./calendar";
import { cellFnOf } from "./engine/prefill";
import { computeQuotas } from "./engine/quota";
import { settleDebts } from "./engine/swaps";
import { validate, RULE_LABELS, type GridCtx, type Issue, type RuleCode } from "./engine/validate";
import {
  emptyPatch, mergePatch, applyToState, notice, opRecompute, monthTargets, prefillSwapCells, prefillSwapCautions,
  type OpsState, type OpPatch,
} from "./ops";

export type EmpSwapKind = "same" | "cross" | "cover";
export type SwapReqStatus = "pending" | "done" | "rejected" | "cancelled" | "failed";

/** 每一天換前的班（a＝申請人、b＝對象） */
export interface SwapReqDay { day: number; aCode: string; bCode: string }

export interface SwapReq {
  id: string;
  ym: string;
  kind: EmpSwapKind;
  a: string;
  b: string;
  give: number[];
  take: number[];
  days: SwapReqDay[];
  note: string;
  warnings: string[];
  status: SwapReqStatus;
  at: string;
  decidedAt?: string;
  reason?: string;
}

export interface SwapReqDoc { ym: string; items: SwapReq[] }

export interface EmpSwapInput { ym: string; kind: EmpSwapKind; a: string; b: string; give: number[]; take: number[]; note: string }

export interface EmpSwapPlan {
  patch: OpPatch;
  give: number[];
  take: number[];
  days: SwapReqDay[];
  hard: string[];
  soft: string[];
}

/** 員工換班時硬性阻擋的規則 */
export const HARD_RULES: RuleCode[] = ["R1", "R2", "R7", "R8", "R11"];

export const KIND_LABELS: Record<EmpSwapKind, string> = { same: "同日互換", cross: "跨日一換一", cover: "代班" };

const md = (ym: string, day: number) => `${ymParts(ym).m}/${day}`;
const nameFn = (people: Person[]) => (id: string) => people.find(p => p.id === id)?.name ?? "—";
const uniq = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y);
const daysText = (ym: string, ds: number[]) => ds.map(d => md(ym, d)).join("、");

export function gridCtxOf(s: OpsState, ym: string): GridCtx {
  const m = s.months[ym];
  const pb = s.prebooks[ym];
  const cell = cellFnOf(m, pb);
  const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell });
  const pm = s.months[prevYm(ym)];
  const nm = nameFn(s.people);
  return {
    month: m, prebook: pb, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems.filter(i => i.enabled), rules: s.rules,
    cell, offSlots: q.offSlots, targets: monthTargets(s, m), name: nm,
    prevTail: pm ? Object.fromEntries(Object.entries(pm.schedule).map(([id, a]) => [id, a.slice(-7)])) : undefined,
    approved: new Set((m.changeLog ?? []).filter(c => c.approved).map(c => c.personId)),
  };
}

const issueKey = (i: Issue) => `${i.rule}|${i.personId ?? ""}|${i.day ?? ""}`;

/** 只看這次換班新造成、與兩人有關（或整天人力）的檢核問題 */
function newIssues(before: OpsState, after: OpsState, ym: string, a: string, b: string): { hard: string[]; soft: string[] } {
  const old = new Set(validate(gridCtxOf(before, ym)).map(issueKey));
  const hard: string[] = [], soft: string[] = [];
  for (const i of validate(gridCtxOf(after, ym))) {
    if (old.has(issueKey(i))) continue;
    if (i.personId && i.personId !== a && i.personId !== b) continue;
    (HARD_RULES.includes(i.rule) ? hard : soft).push(`${RULE_LABELS[i.rule]}：${i.message}`);
  }
  return { hard, soft };
}

/** 規劃一次換班：檢查輸入並產生變更；hard 非空時不可套用 */
export function planEmpSwap(s: OpsState, inp: EmpSwapInput, reqId: string, actor: string, now: string, today: string): EmpSwapPlan {
  const { ym, kind, a, b } = inp;
  const m0 = s.months[ym];
  if (!m0) throw new Error("找不到這個月份");
  if (m0.status !== "published" && m0.status !== "open") throw new Error("這個月份正在排班，暫停換班");
  if (a === b) throw new Error("不能跟自己換班");
  const active = new Set(m0.roster.filter(r => r.flags.active).map(r => r.personId));
  if (!active.has(a) || !active.has(b)) throw new Error("兩人都要在這個月份的排班名單中");
  const nd = daysIn(ym);
  const okDay = (d: number) => Number.isInteger(d) && d >= 1 && d <= nd;
  let give = uniq(inp.give), take = uniq(inp.take);
  if (![...give, ...take].every(okDay)) throw new Error("日期錯誤");
  if (kind === "same") take = give;
  if (kind === "cover") take = [];
  if (!give.length) throw new Error("請選擇要換出的日子");
  if (kind === "cross" && !take.length) throw new Error("請選擇對方要換給你的日子");
  if (kind === "cross" && give.some(d => take.includes(d))) throw new Error("跨日換班的兩邊不能是同一天，請改用同日互換");
  const nm = nameFn(s.people);

  if (m0.status === "published") {
    const all = uniq([...give, ...take]);
    const first = `${ym}${String(all[0]).padStart(2, "0")}`;
    if (first < today) throw new Error("已經過去的日子不能換班");
    const m = clone(m0);
    m.schedule[a] ??= Array(nd).fill("");
    m.schedule[b] ??= Array(nd).fill("");
    const days: SwapReqDay[] = [];
    const recs: SwapRec[] = [];
    for (const d of all) {
      const aCode = m.schedule[a][d - 1] ?? "", bCode = m.schedule[b][d - 1] ?? "";
      if (aCode === bCode) throw new Error(`${md(ym, d)} 兩人的班一樣（${aCode || "空白"}），不用換`);
      days.push({ day: d, aCode, bCode });
      m.schedule[a][d - 1] = bCode;
      m.schedule[b][d - 1] = aCode;
      recs.push({ id: newId(), day: d, a, b, aCode, bCode, at: now, by: actor, note: inp.note || KIND_LABELS[kind], req: reqId, settled: true });
    }
    m.swaps = [...(m.swaps ?? []), ...recs];
    const debts = settleDebts(s.debts, { ...m, swaps: recs.map(r => ({ ...r, settled: false })) }, s.quotaItems.filter(i => i.enabled));
    const detail = days.map(x => `${md(ym, x.day)} ${nm(a)} ${x.aCode || "空白"}↔${nm(b)} ${x.bCode || "空白"}`).join("、");
    const patch: OpPatch = { ...emptyPatch(), months: [m], debts };
    const after = applyToState(s, patch);
    const chk = newIssues(s, after, ym, a, b);
    patch.logs.push({ scope: ym, action: "員工換班", detail: `${KIND_LABELS[kind]}：${detail}${inp.note ? `（${inp.note}）` : ""}${chk.soft.length ? `；注意：${chk.soft.join("；")}` : ""}`, actor });
    return { patch, give, take: kind === "same" ? give : take, days, ...chk };
  }

  // 開放預班：只換系統預填
  const pb = s.prebooks[ym];
  const sysOf = (id: string, d: number) => { const c = pb?.cells[cellKey(id, d)]; return c?.src === "sys" && c.v ? c.v : ""; };
  const expand = (id: string, ds: number[]) => {
    for (const d of ds) if (!sysOf(id, d)) throw new Error(`${md(ym, d)} ${nm(id)} 沒有系統預填，預班期間只能換系統預填的班`);
    return uniq(ds.flatMap(d => prefillSwapCells(s, ym, id, d).map(c => c.day)));
  };
  give = expand(a, give);
  take = expand(b, take);
  const days: SwapReqDay[] = uniq([...give, ...take]).map(d => ({ day: d, aCode: sysOf(a, d), bCode: sysOf(b, d) }));
  const m = clone(m0);
  const group = newId();
  const rec = (from: string, to: string, d: number): PrefillSwap => ({ id: newId(), group, day: d, code: sysOf(from, d), from, to, at: now, by: actor, note: inp.note || `員工${KIND_LABELS[kind]}` });
  m.prefillSwaps = [
    ...(m.prefillSwaps ?? []).filter(x => !((x.from === a && give.includes(x.day)) || (x.from === b && take.includes(x.day)))),
    ...give.map(d => rec(a, b, d)), ...take.map(d => rec(b, a, d)),
  ];
  let patch: OpPatch = { ...emptyPatch(), months: [m] };
  const when = [give.length ? `${nm(a)} ${daysText(ym, give)} → ${nm(b)}` : "", take.length ? `${nm(b)} ${daysText(ym, take)} → ${nm(a)}` : ""].filter(Boolean).join("；");
  patch = mergePatch(patch, opRecompute(applyToState(s, patch), ym, `員工換班（${when}）`, now));
  const after = applyToState(s, patch);
  const chk = newIssues(s, after, ym, a, b);
  const cautions = [
    ...(give.length ? prefillSwapCautions(s, ym, b, give.map(d => ({ day: d, code: sysOf(a, d) }))).map(c => `${nm(b)}：${c}`) : []),
    ...(take.length ? prefillSwapCautions(s, ym, a, take.map(d => ({ day: d, code: sysOf(b, d) }))).map(c => `${nm(a)}：${c}`) : []),
  ].filter(c => !/已有系統預填/.test(c) || kind !== "same");
  chk.soft.unshift(...cautions);
  patch.logs.unshift({ scope: ym, action: "員工換班", detail: `${KIND_LABELS[kind]}（預填）：${when}${inp.note ? `（${inp.note}）` : ""}${chk.soft.length ? `；注意：${chk.soft.join("；")}` : ""}`, actor });
  return { patch, give, take, days, ...chk };
}

/** 換班內容的一行描述（通知與清單用） */
export function describeReq(r: Pick<SwapReq, "ym" | "kind" | "a" | "b" | "days">, people: Person[]): string {
  const nm = nameFn(people);
  return `${KIND_LABELS[r.kind]} ${r.days.map(x => `${md(r.ym, x.day)} ${nm(r.a)} ${x.aCode || "空白"}↔${nm(r.b)} ${x.bCode || "空白"}`).join("、")}`;
}

const staffIds = (people: Person[]) => people.filter(p => p.active && p.role !== "employee").map(p => p.id);

/** 提出申請：只做檢查與記錄，不改班表 */
export function opRequestSwap(
  s: OpsState, reqs: SwapReqDoc, inp: EmpSwapInput, actor: string, now: string, today: string,
): { plan: EmpSwapPlan; reqs: SwapReqDoc; req: SwapReq; notices: ReturnType<typeof notice>[] } {
  const id = newId();
  const plan = planEmpSwap(s, inp, id, actor, now, today);
  if (plan.hard.length) return { plan, reqs, req: null as unknown as SwapReq, notices: [] };
  const req: SwapReq = {
    id, ym: inp.ym, kind: inp.kind, a: inp.a, b: inp.b, give: plan.give, take: plan.take, days: plan.days,
    note: inp.note, warnings: plan.soft, status: "pending", at: now,
  };
  const out = clone(reqs);
  out.items.push(req);
  const nm = nameFn(s.people);
  return { plan, reqs: out, req, notices: [notice(inp.b, `${nm(inp.a)} 想跟你換班：${describeReq(req, s.people)}，請到「我的班」回覆`, now)] };
}

/** 同意：以最新班表重新檢查，通過就套用 */
export function opAcceptSwap(
  s: OpsState, reqs: SwapReqDoc, id: string, me: string, actor: string, now: string, today: string,
): { patch: OpPatch; reqs: SwapReqDoc; error?: string } {
  const out = clone(reqs);
  const r = out.items.find(x => x.id === id);
  if (!r || r.b !== me) throw new Error("找不到這筆換班申請");
  if (r.status !== "pending") throw new Error("這筆申請已經處理過了");
  const nm = nameFn(s.people);
  const fail = (why: string) => {
    r.status = "failed"; r.decidedAt = now; r.reason = why;
    const p = emptyPatch();
    p.notices.push(notice(r.a, `你跟 ${nm(r.b)} 的換班沒有成立：${why}`, now));
    return { patch: p, reqs: out, error: why };
  };
  let plan: EmpSwapPlan;
  try {
    plan = planEmpSwap(s, { ym: r.ym, kind: r.kind, a: r.a, b: r.b, give: r.give, take: r.take, note: r.note }, r.id, actor, now, today);
  } catch (e) {
    return fail((e as Error).message);
  }
  const same = (x: SwapReqDay[], y: SwapReqDay[]) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(plan.days, r.days)) return fail("申請後班表已變動，請重新提出");
  if (plan.hard.length) return fail(plan.hard.join("；"));
  r.status = "done"; r.decidedAt = now; r.warnings = plan.soft;
  const p = plan.patch;
  const text = describeReq(r, s.people);
  p.notices.push(notice(r.a, `${nm(r.b)} 已同意換班：${text}`, now));
  p.notices.push(notice(r.b, `你已同意換班：${text}`, now));
  for (const sid of staffIds(s.people)) {
    if (sid === r.a || sid === r.b) continue;
    p.notices.push(notice(sid, `員工換班已生效：${text}${plan.soft.length ? `（注意：${plan.soft.join("；")}）` : ""}`, now));
  }
  return { patch: p, reqs: out };
}

/** 拒絕（對象）或撤回（申請人） */
export function opCloseSwap(
  s: OpsState, reqs: SwapReqDoc, id: string, me: string, how: "rejected" | "cancelled", now: string,
): { reqs: SwapReqDoc; notices: ReturnType<typeof notice>[] } {
  const out = clone(reqs);
  const r = out.items.find(x => x.id === id);
  if (!r || (how === "rejected" ? r.b : r.a) !== me) throw new Error("找不到這筆換班申請");
  if (r.status !== "pending") throw new Error("這筆申請已經處理過了");
  r.status = how; r.decidedAt = now;
  const nm = nameFn(s.people);
  const text = describeReq(r, s.people);
  return {
    reqs: out,
    notices: [how === "rejected"
      ? notice(r.a, `${nm(r.b)} 婉拒了換班：${text}`, now)
      : notice(r.b, `${nm(r.a)} 撤回了換班申請：${text}`, now)],
  };
}

// ── 伺服器端：文件 ↔ 狀態 ─────────────────────────────────────────────
export type DocMap = Record<string, unknown>;

export function stateOf(docs: DocMap): OpsState {
  const byPrefix = <T>(prefix: string) => Object.fromEntries(
    Object.keys(docs).filter(k => k.startsWith(prefix) && docs[k]).map(k => [k.slice(prefix.length), clone(docs[k] as T)]),
  );
  const get = <T>(k: string, d: T): T => clone((docs[k] as T) ?? d);
  return {
    people: get("people", []), shifts: get("shifts", DEFAULT_SHIFTS), quotaItems: get("quotaItems", DEFAULT_QUOTA_ITEMS),
    rules: get("rules", DEFAULT_RULES), holidays: get("holidays", { days: {}, workdays: [], cny: [] }),
    holidayDuty: get("holidayDuty", {}), duty84: get("duty84", { log: [], removedDates: [], addedDates: [] }),
    cny: get("cny", { lastD: {}, log: [] }), debts: get("debts", []),
    months: byPrefix<MonthDoc>("month:"), prebooks: byPrefix<PrebookDoc>("prebook:"),
  };
}

/** patch → 要寫回的文件（notices、log 以既有內容附加） */
export function docsOfPatch(docs: DocMap, p: OpPatch, now: string): DocMap {
  const out: DocMap = {};
  for (const m of p.months) out[`month:${m.ym}`] = m;
  for (const pb of p.prebooks) out[`prebook:${pb.ym}`] = pb;
  if (p.duty84) out.duty84 = p.duty84;
  if (p.cny) out.cny = p.cny;
  if (p.debts) out.debts = p.debts;
  if (p.notices.length) out.notices = [...((docs.notices as NoticeItem[]) ?? []), ...p.notices];
  for (const e of p.ests) out[`est:${e.ym}`] = e;
  for (const l of p.logs) {
    const k = `log:${l.scope}`;
    const d = (out[k] ?? clone((docs[k] as LogDoc) ?? { key: l.scope, entries: [] })) as LogDoc;
    d.entries.push({ at: now, actor: l.actor, action: l.action, detail: l.detail });
    if (d.entries.length > 2000) d.entries.splice(0, d.entries.length - 2000);
    out[k] = d;
  }
  return out;
}

export type { OpsState, OpPatch } from "./ops";
