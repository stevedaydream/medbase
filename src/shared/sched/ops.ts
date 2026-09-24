/**
 * 排班流程操作（ADR-015）：純函式，回傳要寫回的文件、通知與操作紀錄。
 * 桌機（SQLite）與手機（IndexedDB）各自以 applyPatch 存檔與同步。
 */
import type {
  MonthDoc, PrebookDoc, Duty84Doc, CnyDoc, DebtRec, NoticeItem, RuleParams, EstDoc, Person, LockInfo,
} from "./types";
import { newId, clone } from "./types";
import { nextYm, ymParts, daysIn } from "./calendar";
import { recomputeFrom, startScheduling, cellFnOf, type SchedSnapshot, type Notice } from "./engine/prefill";
import { computeQuotas } from "./engine/quota";
import { settleDebts, targetsWithSwaps } from "./engine/swaps";

export interface OpsState extends SchedSnapshot {
  rules: RuleParams;
  debts: DebtRec[];
}

export interface LogOut { scope: string; action: string; detail: string; actor: string }

export interface OpPatch {
  months: MonthDoc[];
  prebooks: PrebookDoc[];
  duty84?: Duty84Doc;
  cny?: CnyDoc;
  debts?: DebtRec[];
  notices: NoticeItem[];      // 新增的通知
  logs: LogOut[];
  ests: EstDoc[];
  warnings: string[];
}

export const emptyPatch = (): OpPatch => ({ months: [], prebooks: [], notices: [], logs: [], ests: [], warnings: [] });

/** 後者覆蓋前者（同月份取後者） */
export function mergePatch(a: OpPatch, b: OpPatch): OpPatch {
  const byYm = <T extends { ym: string }>(x: T[], y: T[]) => [...new Map([...x, ...y].map(d => [d.ym, d])).values()];
  return {
    months: byYm(a.months, b.months), prebooks: byYm(a.prebooks, b.prebooks),
    duty84: b.duty84 ?? a.duty84, cny: b.cny ?? a.cny, debts: b.debts ?? a.debts,
    notices: [...a.notices, ...b.notices], logs: [...a.logs, ...b.logs], ests: byYm(a.ests, b.ests),
    warnings: [...a.warnings, ...b.warnings],
  };
}

/** 將 patch 套到狀態快照（連續操作時使用） */
export function applyToState(s: OpsState, p: OpPatch): OpsState {
  const out = { ...s, months: { ...s.months }, prebooks: { ...s.prebooks } };
  for (const m of p.months) out.months[m.ym] = m;
  for (const pb of p.prebooks) out.prebooks[pb.ym] = pb;
  if (p.duty84) out.duty84 = p.duty84;
  if (p.cny) out.cny = p.cny;
  if (p.debts) out.debts = p.debts;
  return out;
}

const nameFn = (people: Person[]) => (id: string | null | undefined) => people.find(p => p.id === id)?.name ?? "—";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const md = (ym: string, day: number) => `${ymParts(ym).m}/${day}`;

export function notice(personId: string, text: string, now: string): NoticeItem {
  return { id: newId(), personId, at: now, text, read: false, sent: false };
}

export function buildEst(s: OpsState, m: MonthDoc, now: string): EstDoc {
  const pb = s.prebooks[m.ym];
  const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, pb) });
  const items = s.quotaItems.filter(i => i.enabled);
  return {
    ym: m.ym, status: m.status, offSlots: q.offSlots,
    quotas: m.status === "published" && m.frozenQuotas ? m.frozenQuotas : q.quotas,
    items: items.map(i => ({ id: i.id, name: i.name })), updatedAt: now,
  };
}

/** 自 from 起往後重算（見 recomputeFrom）；只回傳有變動的文件 */
export function opRecompute(s: OpsState, from: string, reason: string, now: string): OpPatch {
  const p = emptyPatch();
  const r = recomputeFrom(s, from, now, reason);
  const nm = nameFn(s.people);
  for (const [ym, m] of Object.entries(r.months)) if (!same(m, s.months[ym])) p.months.push(m);
  for (const [ym, pb] of Object.entries(r.prebooks)) if (!same(pb, s.prebooks[ym])) p.prebooks.push(pb);
  if (!same(r.duty84, s.duty84)) p.duty84 = r.duty84;
  if (!same(r.cny, s.cny)) p.cny = r.cny;
  p.notices = r.notices.map(n => notice(n.personId, noticeText(n), now));
  p.warnings = r.warnings;
  const next = applyToState(s, p);
  for (const [ym, m] of Object.entries(r.months)) {
    if (ym < from) continue;
    p.ests.push(buildEst(next, m, now));
    if (m.status !== "open") continue;
    const sys = Object.values(r.prebooks[ym]?.cells ?? {}).filter(c => c.src === "sys").length;
    const ns = r.notices.filter(n => n.ym === ym);
    const vs = s.quotaItems.filter(i => i.enabled).map(i => `${i.name}=${nm(m.markers[i.id]?.v)}`).join("、");
    const parts = [`原因：${reason}`, `預填 ${sys} 格`, `餘數起點 V：${vs}`];
    if (ns.length) parts.push(`覆蓋預班 ${ns.length} 筆（${ns.map(n => `${nm(n.personId)} ${n.day} 日 ${n.oldValue}→${n.newValue}`).join("、")}），已通知`);
    const ws = r.warnings.filter(w => w.startsWith(ym)).map(w => w.slice(ym.length + 1));
    if (ws.length) parts.push(`提示：${ws.join("；")}`);
    p.logs.push({ scope: ym, action: "重新計算預填", detail: parts.join("；"), actor: "system" });
  }
  return p;
}

export function noticeText(n: Notice): string {
  return `${md(n.ym, n.day)} 的預班「${n.oldValue}」已改為「${n.newValue}」：${n.reason}`;
}

/** 開始排班（上月未發布需 force） */
export function opStartMonth(s: OpsState, ym: string, force: boolean, actor: string, now: string): OpPatch {
  const r = startScheduling(s, ym, now, { force });
  if (r.error) throw new Error(r.error);
  const nm = nameFn(s.people);
  const q = computeQuotas({
    month: r.month, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems,
    cell: (id, d) => r.month.schedule[id]?.[d - 1] ?? "",
  });
  const summary = s.quotaItems.filter(i => i.enabled)
    .map(i => `${i.name} 總 ${q.totals[i.id]}（V ${nm(q.markers[i.id]?.v)}→X ${nm(q.markers[i.id]?.x)}）`).join("；");
  let p: OpPatch = { ...emptyPatch(), months: [r.month] };
  p.logs.push({ scope: ym, action: "開始排班", detail: `${force ? "（上月未發布，強制以目前 X 交接）" : ""}預班凍結並帶入排班層；${summary}`, actor });
  const next = applyToState(s, p);
  p.ests.push(buildEst(next, r.month, now));
  if (s.months[nextYm(ym)]) p = mergePatch(p, opRecompute(next, nextYm(ym), `${ym} 開始排班`, now));
  return p;
}

/** 發布：配額與 X 定案、換班結算欠班、通知全體（推送手機班表由呼叫端處理） */
export function opPublish(s: OpsState, ym: string, unresolved: number, actor: string, now: string): OpPatch {
  const m0 = s.months[ym];
  if (!m0 || m0.status !== "scheduling") throw new Error("此月份不在排班中");
  const m = clone(m0);
  const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, s.prebooks[ym]) });
  m.frozenQuotas = q.quotas;
  for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
  m.status = "published";
  m.publishedAt = now;
  const debts = settleDebts(s.debts, m, s.quotaItems.filter(i => i.enabled));
  let p: OpPatch = { ...emptyPatch(), months: [m], debts };
  const added = debts.length - s.debts.length;
  p.logs.push({ scope: ym, action: "發布", detail: `${unresolved ? `仍有 ${unresolved} 項檢核警告（已確認）；` : ""}配額與 X 定案${added > 0 ? `；新增欠班 ${added} 筆` : ""}`, actor });
  p.notices = m.roster.filter(r => r.flags.active).map(r => notice(r.personId, `${ymParts(ym).y}/${ymParts(ym).m} 班表已發布`, now));
  const next = applyToState(s, p);
  p.ests.push(buildEst(next, m, now));
  if (s.months[nextYm(ym)]) p = mergePatch(p, opRecompute(next, nextYm(ym), `${ym} 發布，X 定案`, now));
  return p;
}

export function revertDeadline(m: MonthDoc, rules: RuleParams): number | null {
  if (m.status !== "published" || m.imported || !m.publishedAt) return null;
  return new Date(m.publishedAt).getTime() + rules.revertHours * 3600_000;
}

export function opRevert(s: OpsState, ym: string, actor: string, now: string): OpPatch {
  const m0 = s.months[ym];
  const dl = m0 ? revertDeadline(m0, s.rules) : null;
  if (!dl || new Date(now).getTime() > dl) throw new Error("已超過可退回期限，請改用「修改已發布班表」");
  const nxt = s.months[nextYm(ym)];
  if (nxt && nxt.status !== "open") throw new Error(`${nextYm(ym)} 已開始排班，無法退回`);
  const m = clone(m0);
  m.status = "scheduling";
  m.frozenQuotas = null;
  const p: OpPatch = { ...emptyPatch(), months: [m] };
  p.logs.push({ scope: ym, action: "退回排班中", detail: "發布後於期限內退回", actor });
  p.ests.push(buildEst(applyToState(s, p), m, now));
  return p;
}

export function opCreateSwap(s: OpsState, ym: string, day: number, a: string, b: string, note: string, actor: string, now: string): OpPatch {
  const m = clone(s.months[ym]);
  const nd = daysIn(ym);
  m.schedule[a] ??= Array(nd).fill("");
  m.schedule[b] ??= Array(nd).fill("");
  const aCode = m.schedule[a][day - 1] ?? "", bCode = m.schedule[b][day - 1] ?? "";
  m.schedule[a][day - 1] = bCode;
  m.schedule[b][day - 1] = aCode;
  (m.swaps ??= []).push({ id: newId(), day, a, b, aCode, bCode, at: now, by: actor, note });
  const nm = nameFn(s.people);
  const p: OpPatch = { ...emptyPatch(), months: [m] };
  p.logs.push({ scope: ym, action: "換班", detail: `${nm(a)} ${md(ym, day)} ${aCode || "空白"} ↔ ${nm(b)} ${bCode || "空白"}${note ? `（${note}）` : ""}`, actor });
  if (m.status === "published") {
    p.notices.push(notice(a, `${md(ym, day)} 你的班 ${aCode || "空白"}→${bCode || "空白"}（與 ${nm(b)} 換班）`, now));
    p.notices.push(notice(b, `${md(ym, day)} 你的班 ${bCode || "空白"}→${aCode || "空白"}（與 ${nm(a)} 換班）`, now));
  }
  return p;
}

export function opDeleteSwap(s: OpsState, ym: string, id: string, actor: string): OpPatch {
  const m = clone(s.months[ym]);
  const sw = m?.swaps?.find(x => x.id === id);
  if (!m || !sw) return emptyPatch();
  if ((m.schedule[sw.a]?.[sw.day - 1] ?? "") === sw.bCode && (m.schedule[sw.b]?.[sw.day - 1] ?? "") === sw.aCode) {
    m.schedule[sw.a][sw.day - 1] = sw.aCode;
    m.schedule[sw.b][sw.day - 1] = sw.bCode;
  }
  m.swaps = m.swaps!.filter(x => x.id !== id);
  const nm = nameFn(s.people);
  return { ...emptyPatch(), months: [m], logs: [{ scope: ym, action: "刪除換班", detail: `${nm(sw.a)} ↔ ${nm(sw.b)} ${md(ym, sw.day)}`, actor }] };
}

export function opSettleDebt(s: OpsState, id: string, note: string, actor: string, now: string): OpPatch {
  const debts = clone(s.debts);
  const d = debts.find(x => x.id === id);
  if (!d) return emptyPatch();
  d.settledAt = now;
  d.note = note || "手動平帳";
  const nm = nameFn(s.people);
  return { ...emptyPatch(), debts, logs: [{ scope: "global", action: "欠班平帳", detail: `${nm(d.from)} 欠 ${nm(d.to)} ${d.item}×${d.qty}：${d.note}`, actor }] };
}

/** 格子異動的通知：發布後修改、代改別人的預班 */
export function cellChangeNotices(
  kind: "published" | "prebook", ym: string, changes: { personId: string; day: number; from: string; to: string }[],
  actorPersonId: string | null, reason: string, now: string,
): NoticeItem[] {
  return changes
    .filter(c => c.personId !== actorPersonId)
    .map(c => notice(c.personId, kind === "published"
      ? `${md(ym, c.day)} 你的班 ${c.from || "空白"}→${c.to || "空白"}：${reason}`
      : `${md(ym, c.day)} 你的預班被排班者改為「${c.to || "空白"}」（原為「${c.from || "空白"}」）`, now));
}

// ── 排班鎖與其他共用小工具 ──────────────────────────────────────────────
export const LOCK_STALE_HOURS = 12;

/** 能否取得排班鎖：自己持有、無人持有、逾時或強制接手 */
export function lockDecision(cur: LockInfo | null, machine: string, nowMs: number, force: boolean): { ok: boolean; takeover: boolean; stale: boolean } {
  if (!cur || cur.machine === machine) return { ok: true, takeover: false, stale: false };
  const stale = nowMs - new Date(cur.at).getTime() > LOCK_STALE_HOURS * 3600_000;
  return { ok: stale || force, takeover: stale || force, stale };
}

/** 配額目標（已發布用定案值）＋換班調整 */
export function monthTargets(s: OpsState, m: MonthDoc): Record<string, Record<string, number>> {
  const base = m.status === "published" && m.frozenQuotas
    ? m.frozenQuotas
    : computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, s.prebooks[m.ym]) }).quotas;
  return targetsWithSwaps(base, m, s.quotaItems.filter(i => i.enabled));
}

/** 發布到手機的列（姓名＋每日班別） */
export function publishRows(m: MonthDoc, people: Person[]): { name: string; days: string[] }[] {
  return m.roster.filter(r => r.flags.active).map(r => ({
    name: people.find(p => p.id === r.personId)?.name ?? "?",
    days: Array.from({ length: daysIn(m.ym) }, (_, i) => m.schedule[r.personId]?.[i] ?? ""),
  }));
}
