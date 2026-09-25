const BLANK_BY_DAYTYPE = {
  weekday: "S1",
  saturday: "H3",
  sunday: null,
  holiday: null
};
const DEFAULT_SHIFTS = [
  { code: "D", name: "白八", color: "blue", hotkey: "d", hours: 12, staffing: true, takesOff: false, reducesOff: false, isRest: false, category: "D" },
  { code: "NrsD", name: "NrsD", color: "cyan", hotkey: "", hours: 12, staffing: true, takesOff: false, reducesOff: false, isRest: false, category: "D" },
  { code: "N", name: "夜班", color: "violet", hotkey: "n", hours: 12, staffing: true, takesOff: false, reducesOff: false, isRest: false, category: "N" },
  { code: "S1", name: "正常班", color: "emerald", hotkey: "s", hours: 8, staffing: true, takesOff: false, reducesOff: false, isRest: false, category: "S1" },
  { code: "H3", name: "週六半天", color: "yellow", hotkey: "h", hours: 4, staffing: true, takesOff: false, reducesOff: false, isRest: false, category: "H3" },
  { code: "OFF", name: "休假", color: "gray", hotkey: "o", hours: 0, staffing: false, takesOff: true, reducesOff: false, isRest: true, category: "OFF" },
  { code: "公假", name: "公假", color: "pink", hotkey: "g", hours: 8, staffing: false, takesOff: true, reducesOff: false, isRest: false, category: "OFF" },
  { code: "8-4", name: "8-4 輪值", color: "orange", hotkey: "8", hours: 8, staffing: false, takesOff: false, reducesOff: true, isRest: false, category: "OTHER" }
];
const CONSTRAINT_MARKS = ["勿休", "勿值"];
const DEFAULT_QUOTA_ITEMS = [
  { id: "D", name: "D", enabled: true, total: "D", dow: null, countShifts: ["D", "NrsD"], exclude: ["noD"] },
  { id: "N", name: "N", enabled: true, total: "N", dow: null, countShifts: ["N"], exclude: ["noN"] },
  { id: "OFF", name: "OFF", enabled: true, total: "OFF", dow: null, countShifts: ["OFF", "公假"], exclude: ["support"] },
  { id: "W6OFF", name: "週六 OFF", enabled: true, total: "OFF", dow: [6], countShifts: ["OFF"], exclude: ["support"] }
];
const DEFAULT_RULES = {
  maxConsecutiveWork: 6,
  maxConsecutiveDuty: 5,
  nightNextOnlyNOrOff: true,
  revertHours: 48,
  disabled: []
};
const DEFAULT_STAFFING = {
  weekday: { D: 1, N: 1, S1: 4 },
  saturday: { D: 1, N: 1, S1: 4 },
  sunday: { D: 1, N: 1, S1: 0 },
  holiday: { D: 1, N: 1, S1: 0 }
};
const cellKey = (personId, day) => `${personId}|${day}`;
function newId() {
  return crypto.randomUUID();
}
function emptyMonth(ym) {
  return {
    ym,
    status: "open",
    roster: [],
    staffing: { base: structuredClone(DEFAULT_STAFFING), ranges: [], dayAdjust: {} },
    schedule: {},
    origin: {},
    markers: {},
    frozenQuotas: null,
    weekend: { start: { wkN: null, satD: null, sunD: null }, end: null },
    startedAt: null,
    publishedAt: null,
    imported: false,
    swaps: [],
    changeLog: []
  };
}
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
const pad = (n) => String(n).padStart(2, "0");
function ymParts(ym) {
  return { y: Number(ym.slice(0, 4)), m: Number(ym.slice(4, 6)) };
}
function toYm(y, m) {
  const d = new Date(y, m - 1, 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}`;
}
const prevYm = (ym) => {
  const { y, m } = ymParts(ym);
  return toYm(y, m - 1);
};
function daysIn(ym) {
  const { y, m } = ymParts(ym);
  return new Date(y, m, 0).getDate();
}
function dateStr(ym, day) {
  const { y, m } = ymParts(ym);
  return `${y}-${pad(m)}-${pad(day)}`;
}
function dowOf(ym, day) {
  const { y, m } = ymParts(ym);
  return new Date(y, m - 1, day).getDay();
}
function isHoliday(h, date) {
  return date in h.days;
}
function dayTypeOf(ym, day, h) {
  const ds = dateStr(ym, day);
  if (isHoliday(h, ds)) return "holiday";
  if (h.workdays.includes(ds)) return "weekday";
  const dw = dowOf(ym, day);
  if (dw === 6) return "saturday";
  if (dw === 0) return "sunday";
  return "weekday";
}
function isRestDay(ym, day, h) {
  return dayTypeOf(ym, day, h) !== "weekday";
}
function inCny(h, date) {
  return h.cny.some((r) => date >= r.from && date <= r.to);
}
function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function ymOfDate(date) {
  return date.slice(0, 4) + date.slice(5, 7);
}
function dayOfDate(date) {
  return Number(date.slice(8, 10));
}
function nextInOrder(order, after, ok) {
  const n = order.length;
  if (!n) return null;
  const start = after ? order.indexOf(after) : -1;
  for (let k = 1; k <= n; k++) {
    const id = order[(start + k + n) % n];
    if (ok(id)) return id;
  }
  return null;
}
function holidayAssigns(ym, h, duty) {
  const out = [];
  for (let d = 1; d <= daysIn(ym); d++) {
    const date = dateStr(ym, d);
    if (!isHoliday(h, date) || inCny(h, date)) continue;
    const e = duty[date.slice(0, 4)]?.[date];
    if (e?.D) out.push({ date, personId: e.D, code: "D", source: "holiday" });
    if (e?.N) out.push({ date, personId: e.N, code: "N", source: "holiday" });
  }
  return out;
}
function weekendAssigns(inp) {
  const { ym, roster, holidays: h } = inp;
  const order = roster.map((r) => r.personId);
  const flags = new Map(roster.map((r) => [r.personId, r.flags]));
  const okD = (id) => {
    const f = flags.get(id);
    return f.active && !f.noD;
  };
  const okN = (id) => {
    const f = flags.get(id);
    return f.active && !f.noN && !f.nightTransfer;
  };
  const lotteryN = (date) => inp.holidayDuty[date.slice(0, 4)]?.[date]?.N ?? null;
  const out = [];
  const warnings = [];
  const end = { ...inp.start };
  const nd = daysIn(ym);
  const isWeekendDay = (date, dow) => {
    if (h.workdays.includes(date)) return false;
    return dow === 6 || dow === 0;
  };
  function pick(ptr, ok, avoid, label) {
    const first = nextInOrder(order, end[ptr], ok);
    const id = nextInOrder(order, end[ptr], (x) => ok(x) && !avoid.has(x));
    if (first && id && first !== id) warnings.push(`${label}：輪到的人當天已有其他班，改由下一位`);
    if (id) end[ptr] = id;
    return id;
  }
  function carryN(date, n, why) {
    if (!n) return null;
    const busy = inp.busy(date);
    if (!busy.has(n)) return n;
    const next = nextInOrder(order, end.wkN, (x) => okN(x) && !busy.has(x));
    if (next) end.wkN = next;
    warnings.push(`${date} 週末 N 原由${why}連值，但當天已有其他預填，改由輪序下一位`);
    return next;
  }
  const nOn = /* @__PURE__ */ new Map();
  for (let d = 1; d <= nd; d++) {
    const date = dateStr(ym, d);
    const dow = dowOf(ym, d);
    if (!isWeekendDay(date, dow) || inCny(h, date)) continue;
    if (dow === 6) {
      const sun = addDays(date, 1);
      const holSat = isHoliday(h, date), holSun = isHoliday(h, sun);
      if (!holSat && !holSun) {
        const busy = /* @__PURE__ */ new Set([...inp.busy(date), ...inp.busy(sun)]);
        const n = pick("wkN", okN, busy, `${date} 週末 N`);
        if (n) {
          nOn.set(date, n);
          nOn.set(sun, n);
          out.push({ date, personId: n, code: "N", source: "weekend" });
          if (ymOfDate(sun) === ym) out.push({ date: sun, personId: n, code: "N", source: "weekend" });
        }
      } else if (holSat && !holSun) {
        const n = ymOfDate(sun) === ym ? carryN(sun, lotteryN(date), "週六國定假日抽籤的 N") : null;
        if (n) {
          nOn.set(sun, n);
          out.push({ date: sun, personId: n, code: "N", source: "weekend" });
        }
      } else if (!holSat && holSun) {
        const n = carryN(date, lotteryN(sun), "週日國定假日抽籤的 N");
        if (n) {
          nOn.set(date, n);
          out.push({ date, personId: n, code: "N", source: "weekend" });
        }
      }
      if (!holSat) {
        const avoid = /* @__PURE__ */ new Set([...inp.busy(date), ...nOn.has(date) ? [nOn.get(date)] : []]);
        const dd = pick("satD", okD, avoid, `${date} 週六 D`);
        if (dd) out.push({ date, personId: dd, code: "D", source: "weekend" });
      }
    } else {
      const holSun = isHoliday(h, date);
      if (d === 1 && !holSun) {
        const sat = addDays(date, -1);
        const n = carryN(date, isHoliday(h, sat) ? lotteryN(sat) : inp.carrySunN, isHoliday(h, sat) ? "週六國定假日抽籤的 N" : "上月週六 N");
        if (n) {
          nOn.set(date, n);
          out.push({ date, personId: n, code: "N", source: "weekend" });
        }
      }
      if (!holSun) {
        const avoid = /* @__PURE__ */ new Set([...inp.busy(date), ...nOn.has(date) ? [nOn.get(date)] : []]);
        const dd = pick("sunD", okD, avoid, `${date} 週日 D`);
        if (dd) out.push({ date, personId: dd, code: "D", source: "weekend" });
      }
    }
  }
  return { assigns: out, end, warnings };
}
function duty84Dates(from, to, h, doc) {
  const out = [];
  const rest = (date) => isRestDay(ymOfDate(date), dayOfDate(date), h);
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!rest(date) || rest(addDays(date, 1)) || inCny(h, date)) continue;
    let len = 1;
    while (rest(addDays(date, -len))) len++;
    const plainWeekend = len === 2 && !isHoliday(h, date) && !isHoliday(h, addDays(date, -1));
    out.push({ date, kind: plainWeekend ? "一般週日" : "連假末日" });
  }
  const removed = new Set(doc.removedDates);
  const list = out.filter((x) => !removed.has(x.date));
  for (const a of doc.addedDates) {
    if (a >= from && a <= to && !list.some((x) => x.date === a)) list.push({ date: a, kind: "手動" });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
function recompute84(doc, people, h, from, to) {
  const order = [...people].sort((a, b) => a.order - b.order);
  const ids = order.map((p) => p.id);
  const ok = (id) => {
    const p = order.find((x) => x.id === id);
    return p.active && !p.exempt84;
  };
  const kept = doc.log.filter((e) => e.date < from).sort((a, b) => a.date.localeCompare(b.date));
  const manual = new Map(doc.log.filter((e) => e.date >= from && e.manual).map((e) => [e.date, e]));
  let ptr = [...kept].reverse().find((e) => e.personId)?.personId ?? null;
  const out = [...kept];
  for (const { date, kind } of duty84Dates(from, to, h, doc)) {
    const m = manual.get(date);
    if (m) {
      out.push(m);
      if (m.personId) ptr = m.personId;
      continue;
    }
    const id = nextInOrder(ids, ptr, ok);
    out.push({ date, personId: id, kind, manual: false, note: "" });
    if (id) ptr = id;
  }
  return out;
}
function recomputeCny(cny, people, h) {
  const order = [...people].sort((a, b) => a.order - b.order);
  const ids = order.map((p) => p.id);
  const ok = (id) => {
    const p = order.find((x) => x.id === id);
    return p.active && !p.exemptCny;
  };
  const lastD = { ...cny.lastD };
  const log = [];
  for (const r of [...h.cny].sort((a, b) => a.from.localeCompare(b.from))) {
    const year = r.from.slice(0, 4);
    let prevD = lastD[String(Number(year) - 1)] ?? null;
    let dPtr = prevD;
    for (let date = r.from; date <= r.to; date = addDays(date, 1)) {
      const d = nextInOrder(ids, dPtr, ok);
      log.push({ date, D: d, N: prevD });
      prevD = d;
      if (d) dPtr = d;
    }
    lastD[year] = prevD;
  }
  return { lastD, log };
}
function cnyAssigns(ym, cny) {
  const out = [];
  for (const e of cny.log) {
    if (ymOfDate(e.date) !== ym) continue;
    if (e.D) out.push({ date: e.date, personId: e.D, code: "D", source: "cny" });
    if (e.N) out.push({ date: e.date, personId: e.N, code: "N", source: "cny" });
  }
  return out;
}
function duty84Assigns(ym, log) {
  return log.filter((e) => ymOfDate(e.date) === ym && e.personId).map((e) => ({ date: e.date, personId: e.personId, code: "8-4", source: "84" }));
}
const CNY_NEED = { D: 1, N: 1, S1: 0 };
function needOf(m, day, h) {
  if (inCny(h, dateStr(m.ym, day))) return CNY_NEED;
  const dt = dayTypeOf(m.ym, day, h);
  const range = [...m.staffing.ranges].reverse().find((r) => day >= r.from && day <= r.to);
  return (range?.table ?? m.staffing.base)[dt];
}
function staffIds$1(m) {
  return m.roster.filter((r) => r.flags.active && !r.flags.support).map((r) => r.personId);
}
function offSlots(m, day, h, shifts, cell, cnyDuty) {
  const ids = staffIds$1(m);
  const reduce = new Set(shifts.filter((s) => s.reducesOff).map((s) => s.code));
  const away = ids.filter((id) => reduce.has(cell(id, day))).length;
  let working;
  if (inCny(h, dateStr(m.ym, day))) {
    working = cnyDuty ? cnyDuty(day) : CNY_NEED.D + CNY_NEED.N;
  } else {
    const n = needOf(m, day, h);
    working = n.D + n.N + n.S1;
  }
  const adj = m.staffing.dayAdjust[day] ?? 0;
  return Math.max(0, ids.length - working - away + adj);
}
function allOffSlots(m, h, shifts, cell, cnyDuty) {
  return Array.from({ length: daysIn(m.ym) }, (_, i) => offSlots(m, i + 1, h, shifts, cell, cnyDuty));
}
function distribute(eligible, dividend, v) {
  const values = {};
  const n = eligible.length;
  if (!n) return { values, x: null };
  const start = v && eligible.includes(v) ? eligible.indexOf(v) : 0;
  const base = Math.floor(dividend / n);
  const rem = dividend - base * n;
  for (const id of eligible) values[id] = base;
  let xi;
  if (rem > 0) {
    for (let j = 0; j < rem; j++) values[eligible[(start + j) % n]] += 1;
    xi = (start + rem - 1) % n;
  } else {
    xi = (start - 1 + n) % n;
  }
  return { values, x: eligible[xi] };
}
function transferNight(nEligible, transfer, nVals, dVals, x) {
  const n = nEligible.length;
  if (!n) return x;
  let xIndex = x && nEligible.includes(x) ? nEligible.indexOf(x) : n - 1;
  let last = null;
  for (const src of nEligible) {
    if (!transfer.has(src)) continue;
    let qty = nVals[src] ?? 0;
    if (qty <= 0) continue;
    nVals[src] = 0;
    let cursor = xIndex, guard = 0;
    while (qty > 0 && guard < n * 3) {
      guard++;
      cursor = (cursor + 1) % n;
      const tgt = nEligible[cursor];
      if (tgt !== src && !transfer.has(tgt) && (dVals[tgt] ?? 0) >= 1) {
        nVals[tgt] = (nVals[tgt] ?? 0) + 1;
        dVals[tgt] -= 1;
        dVals[src] = (dVals[src] ?? 0) + 1;
        qty--;
        last = tgt;
        xIndex = cursor;
      }
    }
  }
  return last ?? x;
}
function holidayCount(ym, h) {
  let c = 0;
  for (let d = 1; d <= daysIn(ym); d++) if (isRestDay(ym, d, h)) c++;
  return c;
}
function isEligible(item, f) {
  return f.active && !item.exclude.some((k) => f[k]);
}
function computeQuotas(inp) {
  const { month: m, holidays: h } = inp;
  const nd = daysIn(m.ym);
  const offSlots2 = allOffSlots(m, h, inp.shifts, inp.cell, inp.cnyDuty);
  const fixedOff = holidayCount(m.ym, h);
  const quotas = {};
  for (const r of m.roster) quotas[r.personId] = {};
  const totals = {};
  const markers = {};
  const dist = {};
  const inDow = (it, d) => !it.dow || it.dow.includes(dowOf(m.ym, d));
  function totalOf(it) {
    let t = 0;
    for (let d = 1; d <= nd; d++) {
      if (!inDow(it, d)) continue;
      if (it.total === "OFF") t += offSlots2[d - 1];
      else t += needOf(m, d, h)[it.total];
    }
    return t;
  }
  const enabled = inp.items.filter((i) => i.enabled);
  for (const it of enabled) {
    const total = totalOf(it);
    totals[it.id] = total;
    let eligible = m.roster.filter((r2) => isEligible(it, r2.flags)).map((r2) => r2.personId);
    let dividend = total;
    let v = m.markers[it.id]?.v ?? null;
    if (it.id === "OFF") {
      const fixed = m.roster.filter((r2) => isEligible(it, r2.flags) && r2.flags.fixedHolidayOff).map((r2) => r2.personId);
      for (const id of fixed) quotas[id][it.id] = fixedOff;
      eligible = eligible.filter((id) => !fixed.includes(id));
      dividend = Math.max(0, total - fixedOff * fixed.length);
      if (v && fixed.includes(v)) {
        const order = m.roster.map((r2) => r2.personId);
        const i = order.indexOf(v);
        v = order.slice(i + 1).concat(order.slice(0, i)).find((id) => eligible.includes(id)) ?? null;
      }
    }
    const r = distribute(eligible, dividend, v);
    dist[it.id] = { ...r, eligible, v };
  }
  if (dist.N && dist.D) {
    const transfer = new Set(m.roster.filter((r) => r.flags.nightTransfer).map((r) => r.personId));
    if (transfer.size) {
      dist.N.x = transferNight(dist.N.eligible, transfer, dist.N.values, dist.D.values, dist.N.x);
    }
  }
  for (const it of enabled) {
    const r = dist[it.id];
    for (const e of m.roster) quotas[e.personId][it.id] ??= 0;
    for (const [id, v] of Object.entries(r.values)) quotas[id][it.id] = v;
    markers[it.id] = { v: r.v, x: r.x };
  }
  return { totals, quotas, markers, offSlots: offSlots2, fixedOff };
}
function handoverV(item, prevRoster, prevMarker, newRoster) {
  if (!prevMarker) return null;
  const { x } = prevMarker;
  if (!x) return prevMarker.v;
  const order = newRoster.map((r) => r.personId);
  let pos = order.indexOf(x);
  if (pos < 0) {
    const prevOrder = prevRoster.map((r) => r.personId);
    const pi = prevOrder.indexOf(x);
    for (let k = 1; k <= prevOrder.length && pos < 0; k++) {
      const cand = prevOrder[(pi + k) % prevOrder.length];
      const ni = order.indexOf(cand);
      if (ni >= 0) pos = ni - 1;
    }
    if (pos < 0) pos = -1;
  }
  const n = newRoster.length;
  for (let k = 1; k <= n; k++) {
    const r = newRoster[(pos + k + n) % n];
    if (isEligible(item, r.flags)) return r.personId;
  }
  return null;
}
function applyWeekendFirst(order, start, first) {
  const out = { wkN: null, satD: null, sunD: null, ...start ?? {} };
  for (const k of ["wkN", "satD", "sunD"]) {
    const id = first?.[k];
    const i = id ? order.indexOf(id) : -1;
    if (i >= 0) out[k] = order[(i - 1 + order.length) % order.length];
  }
  return out;
}
const isMark = (v) => !!v && CONSTRAINT_MARKS.includes(v);
function prebookValue(pb, personId, day) {
  return pb?.cells[cellKey(personId, day)]?.v ?? "";
}
function cellFnOf(m, pb) {
  if (m.status === "open") return (id, d) => {
    const v = prebookValue(pb, id, d);
    return isMark(v) ? "" : v;
  };
  return (id, d) => m.schedule[id]?.[d - 1] ?? "";
}
function newMonthFrom(prev, ym) {
  const m = emptyMonth(ym);
  if (prev) {
    m.roster = clone(prev.roster);
    m.staffing.base = clone(prev.staffing.base);
  }
  return m;
}
function monthAssigns(s, m, prev, cny, log84) {
  const inRoster = new Set(m.roster.map((r) => r.personId));
  const fixed = [
    ...cnyAssigns(m.ym, cny),
    ...duty84Assigns(m.ym, log84),
    ...holidayAssigns(m.ym, s.holidays, s.holidayDuty)
  ];
  const busyMap = /* @__PURE__ */ new Map();
  for (const a of fixed) {
    if (!busyMap.has(a.date)) busyMap.set(a.date, /* @__PURE__ */ new Set());
    busyMap.get(a.date).add(a.personId);
  }
  const start = applyWeekendFirst(m.roster.map((r) => r.personId), prev?.weekend.end ?? m.weekend.start, m.weekendFirst);
  const lastPrev = prev ? daysIn(prev.ym) : 0;
  const carrySunN = prev && dowOf(prev.ym, lastPrev) === 6 ? prev.weekend.end?.wkN ?? null : null;
  const wk = weekendAssigns({
    ym: m.ym,
    roster: m.roster,
    holidays: s.holidays,
    holidayDuty: s.holidayDuty,
    start: start ?? { wkN: null, satD: null, sunD: null },
    carrySunN,
    busy: (date) => busyMap.get(date) ?? /* @__PURE__ */ new Set()
  });
  const warnings = [...wk.warnings];
  const raw = [...fixed, ...wk.assigns];
  for (const sw of m.prefillSwaps ?? []) {
    const date = dateStr(m.ym, sw.day);
    const hit = raw.find((a) => a.date === date && a.code === sw.code && a.personId === sw.from);
    if (hit) hit.personId = sw.to;
    else warnings.push(`${date} 預填換人失效：輪序已不是由該員上 ${sw.code}`);
  }
  const all = raw.filter((a) => inRoster.has(a.personId));
  const seen = /* @__PURE__ */ new Set();
  const kept = /* @__PURE__ */ new Map();
  const assigns = all.filter((a) => {
    const k = `${a.personId}|${a.date}`;
    if (seen.has(k)) {
      warnings.push(`${a.date} 同一人同一天有兩個預填（${kept.get(k).code}、${a.code}），只保留 ${kept.get(k).code}`);
      return false;
    }
    seen.add(k);
    kept.set(k, a);
    return true;
  });
  return { assigns, end: wk.end, warnings };
}
function applyPrefill(pb, assigns, now, reason) {
  const doc = { ym: pb.ym, cells: {} };
  for (const [k, c] of Object.entries(pb.cells)) if (c.src !== "sys") doc.cells[k] = c;
  const notices = [];
  for (const a of assigns) {
    const day = dayOfDate(a.date);
    const k = cellKey(a.personId, day);
    const old = doc.cells[k];
    if (old && old.src === "emp" && old.v && old.v !== a.code) {
      notices.push({ personId: a.personId, ym: pb.ym, day, oldValue: old.v, newValue: a.code, reason });
    }
    doc.cells[k] = { v: a.code, src: "sys", by: "system", at: now, reason };
  }
  return { doc, notices };
}
function recomputeFrom(s, fromYm, now, reason) {
  const months = clone(s.months);
  const prebooks = clone(s.prebooks);
  const warnings = [];
  const notices = [];
  const allYms = [.../* @__PURE__ */ new Set([...Object.keys(months), ...Object.keys(prebooks)])].sort();
  for (const ym of allYms) {
    if (!months[ym]) months[ym] = newMonthFrom(months[prevYm(ym)] ?? findPrev(months, ym), ym);
    prebooks[ym] ??= { ym, cells: {} };
  }
  const yms = Object.keys(months).sort();
  const last = yms[yms.length - 1];
  const horizon = last ? dateStr(last, daysIn(last)) : dateStr(fromYm, daysIn(fromYm));
  const duty84 = { ...clone(s.duty84), log: recompute84(s.duty84, s.people, s.holidays, dateStr(fromYm, 1), horizon) };
  const cny = recomputeCny(s.cny, s.people, s.holidays);
  for (const ym of yms) {
    if (ym < fromYm) continue;
    const m = months[ym];
    if (m.status !== "open") continue;
    const prev = months[prevYm(ym)];
    if (prev) {
      for (const it of s.quotaItems) {
        m.markers[it.id] = { v: m.vOverride?.[it.id] ?? handoverV(it, prev.roster, prev.markers[it.id], m.roster), x: null };
      }
      m.weekend.start = prev.weekend.end ?? m.weekend.start;
    }
    const { assigns, end, warnings: w } = monthAssigns(s, m, prev, cny, duty84.log);
    warnings.push(...w.map((x) => `${ym}：${x}`));
    m.weekend.end = end;
    const r = applyPrefill(prebooks[ym], assigns, now, reason);
    prebooks[ym] = r.doc;
    notices.push(...r.notices);
    const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, r.doc) });
    for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
  }
  return { months, prebooks, duty84, cny, notices, warnings };
}
function findPrev(months, ym) {
  const earlier = Object.keys(months).filter((k) => k < ym).sort();
  return earlier.length ? months[earlier[earlier.length - 1]] : void 0;
}
function inItem(it, code, ym, day) {
  if (!code || !it.countShifts.includes(code)) return 0;
  if (it.dow && !it.dow.includes(dowOf(ym, day))) return 0;
  return 1;
}
function swapAdjust(m, items) {
  const adj = {};
  const add = (id, k, v) => {
    if (!v) return;
    adj[id] ??= {};
    adj[id][k] = (adj[id][k] ?? 0) + v;
  };
  for (const s of m.swaps ?? []) {
    for (const it of items) {
      const d = inItem(it, s.bCode, m.ym, s.day) - inItem(it, s.aCode, m.ym, s.day);
      add(s.a, it.id, d);
      add(s.b, it.id, -d);
    }
  }
  return adj;
}
function targetsWithSwaps(quotas, m, items) {
  const adj = swapAdjust(m, items);
  const out = {};
  for (const [id, q] of Object.entries(quotas)) {
    out[id] = { ...q };
    for (const [k, v] of Object.entries(adj[id] ?? {})) out[id][k] = (out[id][k] ?? 0) + v;
  }
  return out;
}
function settleDebts(debts, m, items) {
  const out = debts.map((d) => ({ ...d }));
  const pair = /* @__PURE__ */ new Map();
  for (const s of m.swaps ?? []) {
    if (s.settled) continue;
    for (const it of items) {
      const dA = inItem(it, s.bCode, m.ym, s.day) - inItem(it, s.aCode, m.ym, s.day);
      if (!dA) continue;
      const [from, to] = dA < 0 ? [s.a, s.b] : [s.b, s.a];
      const k = `${from}|${to}|${it.id}`, rk = `${to}|${from}|${it.id}`;
      const rev = pair.get(rk) ?? 0;
      const n = Math.abs(dA);
      if (rev >= n) pair.set(rk, rev - n);
      else {
        pair.delete(rk);
        pair.set(k, (pair.get(k) ?? 0) + n - rev);
      }
    }
  }
  for (const [k, qty0] of pair) {
    let qty = qty0;
    if (!qty) continue;
    const [from, to, item] = k.split("|");
    for (const d of out) {
      if (!qty) break;
      if (d.settledAt || d.from !== to || d.to !== from || d.item !== item) continue;
      const use = Math.min(d.qty, qty);
      d.qty -= use;
      qty -= use;
      if (d.qty === 0) {
        d.settledAt = (/* @__PURE__ */ new Date()).toISOString();
        d.note = `${d.note ? d.note + "；" : ""}${m.ym} 換班抵銷`;
      }
    }
    if (qty) out.push({ id: newId(), from, to, item, qty, ym: m.ym, settledAt: null, note: "" });
  }
  return out;
}
const RULE_LABELS = {
  R1: "連續上班超過上限",
  R2: "連續值班超過上限",
  R3: "預班勿休卻排休",
  R4: "預班勿值卻排值班",
  R5: "違反不排 D／不排 N",
  R6: "OFF 只能排在假日",
  R7: "每日人力不符",
  R8: "休假人數超過可休",
  R9: "配額不符",
  R10: "週日／國定假日空白",
  R11: "N 隔天只能 N 或 OFF",
  R12: "覆蓋預班或預填"
};
function shiftMap(shifts) {
  return new Map(shifts.map((s) => [s.code, s]));
}
function effectiveCode(ctx, personId, day) {
  const v = ctx.cell(personId, day);
  if (v) return v;
  return BLANK_BY_DAYTYPE[dayTypeOf(ctx.month.ym, day, ctx.holidays)] ?? "";
}
function personStats(ctx, personId) {
  const sm = shiftMap(ctx.shifts);
  const counts = {};
  const byCode = {};
  let hours = 0;
  const nd = daysIn(ctx.month.ym);
  for (const it of ctx.items) counts[it.id] = 0;
  for (let d = 1; d <= nd; d++) {
    const raw = ctx.cell(personId, d);
    const eff = effectiveCode(ctx, personId, d);
    if (eff) byCode[eff] = (byCode[eff] ?? 0) + 1;
    hours += sm.get(eff)?.hours ?? 0;
    for (const it of ctx.items) {
      if (it.dow && !it.dow.includes(dowOf(ctx.month.ym, d))) continue;
      if (raw && it.countShifts.includes(raw)) counts[it.id]++;
    }
  }
  return { counts, hours, byCode };
}
function dayStats(ctx, day) {
  const sm = shiftMap(ctx.shifts);
  const st = { D: 0, N: 0, S1: 0, off: 0 };
  for (const r of ctx.month.roster) {
    if (!r.flags.active) continue;
    const s = sm.get(effectiveCode(ctx, r.personId, day));
    if (!s) continue;
    if (s.takesOff) st.off++;
    if (!s.staffing) continue;
    if (s.category === "D") st.D++;
    else if (s.category === "N") st.N++;
    else if (s.category === "S1" || s.category === "H3") {
      if (!r.flags.support) st.S1++;
    }
  }
  return st;
}
function validate(ctx) {
  const { month: m, holidays: h, rules } = ctx;
  const off = new Set(rules.disabled);
  const on = (r) => !off.has(r);
  const sm = shiftMap(ctx.shifts);
  const nd = daysIn(m.ym);
  const out = [];
  const scheduling = m.status !== "open";
  const d2 = (d) => `${Number(m.ym.slice(4))}/${d}`;
  for (const r of m.roster) {
    if (!r.flags.active) continue;
    const id = r.personId, nm = ctx.name(id);
    const tail = ctx.prevTail?.[id] ?? [];
    let work = 0, duty = 0;
    for (const c of tail) {
      const s = sm.get(c);
      work = !c || s?.isRest ? 0 : work + 1;
      duty = s && (s.category === "D" || s.category === "N") ? duty + 1 : 0;
    }
    for (let d = 1; d <= nd; d++) {
      const raw = ctx.cell(id, d);
      const eff = effectiveCode(ctx, id, d);
      const s = sm.get(eff);
      const dt = dayTypeOf(m.ym, d, h);
      const pre = ctx.prebook?.cells[cellKey(id, d)]?.v ?? "";
      work = !eff || s?.isRest ? 0 : work + 1;
      if (on("R1") && scheduling && work === rules.maxConsecutiveWork + 1) {
        out.push({ rule: "R1", personId: id, day: d, message: `${nm} 至 ${d2(d)} 已連續上班 ${work} 天（上限 ${rules.maxConsecutiveWork}）` });
      }
      const isDuty = s && (s.category === "D" || s.category === "N");
      duty = isDuty ? duty + 1 : 0;
      if (on("R2") && scheduling && duty === rules.maxConsecutiveDuty + 1) {
        out.push({ rule: "R2", personId: id, day: d, message: `${nm} 至 ${d2(d)} 已連續值班 ${duty} 天（上限 ${rules.maxConsecutiveDuty}）` });
      }
      if (on("R3") && pre === "勿休" && s?.category === "OFF") {
        out.push({ rule: "R3", personId: id, day: d, message: `${nm} ${d2(d)} 預班勿休，卻排了 ${eff}` });
      }
      if (on("R4") && pre === "勿值" && isDuty) {
        out.push({ rule: "R4", personId: id, day: d, message: `${nm} ${d2(d)} 預班勿值，卻排了 ${eff}` });
      }
      if (on("R5") && (r.flags.noD && s?.category === "D" || r.flags.noN && s?.category === "N")) {
        out.push({ rule: "R5", personId: id, day: d, message: `${nm} 不排 ${s.category}，${d2(d)} 卻排了 ${eff}` });
      }
      if (on("R6") && r.flags.offHolidayOnly && s?.category === "OFF" && s.isRest && dt === "weekday") {
        out.push({ rule: "R6", personId: id, day: d, message: `${nm} OFF 只能排在假日，${d2(d)} 是平日` });
      }
      if (on("R10") && scheduling && !eff && (dt === "sunday" || dt === "holiday")) {
        out.push({ rule: "R10", personId: id, day: d, message: `${nm} ${d2(d)} 是${dt === "sunday" ? "週日" : "國定假日"}，不可空白` });
      }
      if (on("R11") && scheduling && rules.nightNextOnlyNOrOff && s?.category === "N" && d < nd) {
        const next = sm.get(effectiveCode(ctx, id, d + 1));
        if (!next || !(next.category === "N" || next.category === "OFF" && next.isRest)) {
          out.push({ rule: "R11", personId: id, day: d + 1, message: `${nm} ${d2(d)} 上 N，隔天排了 ${effectiveCode(ctx, id, d + 1) || "空白"}` });
        }
      }
      if (on("R12") && scheduling && pre && pre !== "勿休" && pre !== "勿值" && raw !== pre) {
        out.push({ rule: "R12", personId: id, day: d, message: `${nm} ${d2(d)} 預班／預填為 ${pre}，目前排 ${raw || "空白"}` });
      }
    }
    if (on("R9") && scheduling && ctx.targets?.[id] && !ctx.approved?.has(id)) {
      const st = personStats(ctx, id);
      for (const it of ctx.items) {
        const t = ctx.targets[id][it.id];
        if (t === void 0 || st.counts[it.id] === t) continue;
        out.push({ rule: "R9", personId: id, day: null, message: `${nm} ${it.name} ${st.counts[it.id]}／配額 ${t}` });
      }
    }
  }
  for (let d = 1; d <= nd; d++) {
    const ds = dayStats(ctx, d);
    if (on("R8") && ds.off > ctx.offSlots[d - 1]) {
      out.push({ rule: "R8", personId: null, day: d, message: `${d2(d)} 休假 ${ds.off} 人，可休 ${ctx.offSlots[d - 1]} 人` });
    }
    if (on("R7") && scheduling && !inCny(h, dateStr(m.ym, d))) {
      const need = needOf(m, d, h);
      const diff = ["D", "N", "S1"].filter((k) => ds[k] !== need[k]).map((k) => `${k} ${ds[k]}／${need[k]}`);
      if (diff.length) out.push({ rule: "R7", personId: null, day: d, message: `${d2(d)} 人力不符：${diff.join("、")}` });
    }
  }
  return out;
}
const emptyPatch = () => ({ months: [], prebooks: [], notices: [], logs: [], ests: [], warnings: [] });
function mergePatch(a, b) {
  const byYm = (x, y) => [...new Map([...x, ...y].map((d) => [d.ym, d])).values()];
  return {
    months: byYm(a.months, b.months),
    prebooks: byYm(a.prebooks, b.prebooks),
    duty84: b.duty84 ?? a.duty84,
    cny: b.cny ?? a.cny,
    debts: b.debts ?? a.debts,
    notices: [...a.notices, ...b.notices],
    logs: [...a.logs, ...b.logs],
    ests: byYm(a.ests, b.ests),
    warnings: [...a.warnings, ...b.warnings]
  };
}
function applyToState(s, p) {
  const out = { ...s, months: { ...s.months }, prebooks: { ...s.prebooks } };
  for (const m of p.months) out.months[m.ym] = m;
  for (const pb of p.prebooks) out.prebooks[pb.ym] = pb;
  if (p.duty84) out.duty84 = p.duty84;
  if (p.cny) out.cny = p.cny;
  if (p.debts) out.debts = p.debts;
  return out;
}
const nameFn$1 = (people) => (id) => people.find((p) => p.id === id)?.name ?? "—";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const md$1 = (ym, day) => `${ymParts(ym).m}/${day}`;
function notice(personId, text, now) {
  return { id: newId(), personId, at: now, text, read: false, sent: false };
}
function buildEst(s, m, now) {
  const pb = s.prebooks[m.ym];
  const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, pb) });
  const items = s.quotaItems.filter((i) => i.enabled);
  return {
    ym: m.ym,
    status: m.status,
    offSlots: q.offSlots,
    quotas: m.status === "published" && m.frozenQuotas ? m.frozenQuotas : q.quotas,
    items: items.map((i) => ({ id: i.id, name: i.name })),
    updatedAt: now
  };
}
function opRecompute(s, from, reason, now) {
  const p = emptyPatch();
  const r = recomputeFrom(s, from, now, reason);
  const nm = nameFn$1(s.people);
  for (const [ym, m] of Object.entries(r.months)) if (!same(m, s.months[ym])) p.months.push(m);
  for (const [ym, pb] of Object.entries(r.prebooks)) if (!same(pb, s.prebooks[ym])) p.prebooks.push(pb);
  if (!same(r.duty84, s.duty84)) p.duty84 = r.duty84;
  if (!same(r.cny, s.cny)) p.cny = r.cny;
  p.notices = r.notices.map((n) => notice(n.personId, noticeText(n), now));
  p.warnings = r.warnings;
  const next = applyToState(s, p);
  for (const [ym, m] of Object.entries(r.months)) {
    if (ym < from) continue;
    p.ests.push(buildEst(next, m, now));
    if (m.status !== "open") continue;
    const sys = Object.values(r.prebooks[ym]?.cells ?? {}).filter((c) => c.src === "sys").length;
    const ns = r.notices.filter((n) => n.ym === ym);
    const vs = s.quotaItems.filter((i) => i.enabled).map((i) => `${i.name}=${nm(m.markers[i.id]?.v)}`).join("、");
    const parts = [`原因：${reason}`, `預填 ${sys} 格`, `餘數起點 V：${vs}`];
    if (ns.length) parts.push(`覆蓋預班 ${ns.length} 筆（${ns.map((n) => `${nm(n.personId)} ${n.day} 日 ${n.oldValue}→${n.newValue}`).join("、")}），已通知`);
    const ws = r.warnings.filter((w) => w.startsWith(ym)).map((w) => w.slice(ym.length + 1));
    if (ws.length) parts.push(`提示：${ws.join("；")}`);
    p.logs.push({ scope: ym, action: "重新計算預填", detail: parts.join("；"), actor: "system" });
  }
  return p;
}
function noticeText(n) {
  return `${md$1(n.ym, n.day)} 的預班「${n.oldValue}」已改為「${n.newValue}」：${n.reason}`;
}
function monthTargets(s, m) {
  const base = m.status === "published" && m.frozenQuotas ? m.frozenQuotas : computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, s.prebooks[m.ym]) }).quotas;
  return targetsWithSwaps(base, m, s.quotaItems.filter((i) => i.enabled));
}
function prefillSwapCautions(s, ym, to, cells) {
  const out = [];
  const f = s.months[ym]?.roster.find((r) => r.personId === to)?.flags;
  const cat = s.shifts.find((x) => x.code === cells[0]?.code)?.category;
  if (f && cat === "N" && f.noN) out.push("設定不排 N");
  if (f && cat === "N" && f.nightTransfer) out.push("設定夜班配額轉出");
  if (f && cat === "D" && f.noD) out.push("設定不排 D");
  for (const c of cells) {
    const busy = s.prebooks[ym]?.cells[`${to}|${c.day}`];
    if (busy?.src === "sys" && busy.v) out.push(`${md$1(ym, c.day)} 已有系統預填 ${busy.v}`);
  }
  return out;
}
function prefillSwapCells(s, ym, personId, day) {
  const pb = s.prebooks[ym];
  const code = pb?.cells[`${personId}|${day}`]?.v ?? "";
  if (!code) return [];
  const cells = [{ day, code }];
  const dw = new Date(Number(ym.slice(0, 4)), Number(ym.slice(4)) - 1, day).getDay();
  const other = dw === 6 ? day + 1 : dw === 0 ? day - 1 : 0;
  const oc = other >= 1 && other <= daysIn(ym) ? pb?.cells[`${personId}|${other}`] : void 0;
  if (code === "N" && oc?.src === "sys" && oc.v === "N") cells.push({ day: other, code: "N" });
  return cells.sort((a, b) => a.day - b.day);
}
const HARD_RULES = ["R1", "R2", "R7", "R8", "R11"];
const KIND_LABELS = { same: "同日互換", cross: "跨日一換一", cover: "代班" };
const md = (ym, day) => `${ymParts(ym).m}/${day}`;
const nameFn = (people) => (id) => people.find((p) => p.id === id)?.name ?? "—";
const uniq = (xs) => [...new Set(xs)].sort((x, y) => x - y);
const daysText = (ym, ds) => ds.map((d) => md(ym, d)).join("、");
function gridCtxOf(s, ym) {
  const m = s.months[ym];
  const pb = s.prebooks[ym];
  const cell = cellFnOf(m, pb);
  const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell });
  const pm = s.months[prevYm(ym)];
  const nm = nameFn(s.people);
  return {
    month: m,
    prebook: pb,
    holidays: s.holidays,
    shifts: s.shifts,
    items: s.quotaItems.filter((i) => i.enabled),
    rules: s.rules,
    cell,
    offSlots: q.offSlots,
    targets: monthTargets(s, m),
    name: nm,
    prevTail: pm ? Object.fromEntries(Object.entries(pm.schedule).map(([id, a]) => [id, a.slice(-7)])) : void 0,
    approved: new Set((m.changeLog ?? []).filter((c) => c.approved).map((c) => c.personId))
  };
}
const issueKey = (i) => `${i.rule}|${i.personId ?? ""}|${i.day ?? ""}`;
function newIssues(before, after, ym, a, b) {
  const old = new Set(validate(gridCtxOf(before, ym)).map(issueKey));
  const hard = [], soft = [];
  for (const i of validate(gridCtxOf(after, ym))) {
    if (old.has(issueKey(i))) continue;
    if (i.personId && i.personId !== a && i.personId !== b) continue;
    (HARD_RULES.includes(i.rule) ? hard : soft).push(`${RULE_LABELS[i.rule]}：${i.message}`);
  }
  return { hard, soft };
}
function planEmpSwap(s, inp, reqId, actor, now, today) {
  const { ym, kind, a, b } = inp;
  const m0 = s.months[ym];
  if (!m0) throw new Error("找不到這個月份");
  if (m0.status !== "published" && m0.status !== "open") throw new Error("這個月份正在排班，暫停換班");
  if (a === b) throw new Error("不能跟自己換班");
  const active = new Set(m0.roster.filter((r) => r.flags.active).map((r) => r.personId));
  if (!active.has(a) || !active.has(b)) throw new Error("兩人都要在這個月份的排班名單中");
  const nd = daysIn(ym);
  const okDay = (d) => Number.isInteger(d) && d >= 1 && d <= nd;
  let give = uniq(inp.give), take = uniq(inp.take);
  if (![...give, ...take].every(okDay)) throw new Error("日期錯誤");
  if (kind === "same") take = give;
  if (kind === "cover") take = [];
  if (!give.length) throw new Error("請選擇要換出的日子");
  if (kind === "cross" && !take.length) throw new Error("請選擇對方要換給你的日子");
  if (kind === "cross" && give.some((d) => take.includes(d))) throw new Error("跨日換班的兩邊不能是同一天，請改用同日互換");
  const nm = nameFn(s.people);
  if (m0.status === "published") {
    const all = uniq([...give, ...take]);
    const first = `${ym}${String(all[0]).padStart(2, "0")}`;
    if (first < today) throw new Error("已經過去的日子不能換班");
    const m2 = clone(m0);
    m2.schedule[a] ??= Array(nd).fill("");
    m2.schedule[b] ??= Array(nd).fill("");
    const days2 = [];
    const recs = [];
    for (const d of all) {
      const aCode = m2.schedule[a][d - 1] ?? "", bCode = m2.schedule[b][d - 1] ?? "";
      if (aCode === bCode) throw new Error(`${md(ym, d)} 兩人的班一樣（${aCode || "空白"}），不用換`);
      days2.push({ day: d, aCode, bCode });
      m2.schedule[a][d - 1] = bCode;
      m2.schedule[b][d - 1] = aCode;
      recs.push({ id: newId(), day: d, a, b, aCode, bCode, at: now, by: actor, note: inp.note || KIND_LABELS[kind], req: reqId, settled: true });
    }
    m2.swaps = [...m2.swaps ?? [], ...recs];
    const debts = settleDebts(s.debts, { ...m2, swaps: recs.map((r) => ({ ...r, settled: false })) }, s.quotaItems.filter((i) => i.enabled));
    const detail = days2.map((x) => `${md(ym, x.day)} ${nm(a)} ${x.aCode || "空白"}↔${nm(b)} ${x.bCode || "空白"}`).join("、");
    const patch2 = { ...emptyPatch(), months: [m2], debts };
    const after2 = applyToState(s, patch2);
    const chk2 = newIssues(s, after2, ym, a, b);
    patch2.logs.push({ scope: ym, action: "員工換班", detail: `${KIND_LABELS[kind]}：${detail}${inp.note ? `（${inp.note}）` : ""}${chk2.soft.length ? `；注意：${chk2.soft.join("；")}` : ""}`, actor });
    return { patch: patch2, give, take: kind === "same" ? give : take, days: days2, ...chk2 };
  }
  const pb = s.prebooks[ym];
  const sysOf = (id, d) => {
    const c = pb?.cells[cellKey(id, d)];
    return c?.src === "sys" && c.v ? c.v : "";
  };
  const expand = (id, ds) => {
    for (const d of ds) if (!sysOf(id, d)) throw new Error(`${md(ym, d)} ${nm(id)} 沒有系統預填，預班期間只能換系統預填的班`);
    return uniq(ds.flatMap((d) => prefillSwapCells(s, ym, id, d).map((c) => c.day)));
  };
  give = expand(a, give);
  take = expand(b, take);
  const days = uniq([...give, ...take]).map((d) => ({ day: d, aCode: sysOf(a, d), bCode: sysOf(b, d) }));
  const m = clone(m0);
  const group = newId();
  const rec = (from, to, d) => ({ id: newId(), group, day: d, code: sysOf(from, d), from, to, at: now, by: actor, note: inp.note || `員工${KIND_LABELS[kind]}` });
  m.prefillSwaps = [
    ...(m.prefillSwaps ?? []).filter((x) => !(x.from === a && give.includes(x.day) || x.from === b && take.includes(x.day))),
    ...give.map((d) => rec(a, b, d)),
    ...take.map((d) => rec(b, a, d))
  ];
  let patch = { ...emptyPatch(), months: [m] };
  const when = [give.length ? `${nm(a)} ${daysText(ym, give)} → ${nm(b)}` : "", take.length ? `${nm(b)} ${daysText(ym, take)} → ${nm(a)}` : ""].filter(Boolean).join("；");
  patch = mergePatch(patch, opRecompute(applyToState(s, patch), ym, `員工換班（${when}）`, now));
  const after = applyToState(s, patch);
  const chk = newIssues(s, after, ym, a, b);
  const cautions = [
    ...give.length ? prefillSwapCautions(s, ym, b, give.map((d) => ({ day: d, code: sysOf(a, d) }))).map((c) => `${nm(b)}：${c}`) : [],
    ...take.length ? prefillSwapCautions(s, ym, a, take.map((d) => ({ day: d, code: sysOf(b, d) }))).map((c) => `${nm(a)}：${c}`) : []
  ].filter((c) => !/已有系統預填/.test(c) || kind !== "same");
  chk.soft.unshift(...cautions);
  patch.logs.unshift({ scope: ym, action: "員工換班", detail: `${KIND_LABELS[kind]}（預填）：${when}${inp.note ? `（${inp.note}）` : ""}${chk.soft.length ? `；注意：${chk.soft.join("；")}` : ""}`, actor });
  return { patch, give, take, days, ...chk };
}
function describeReq(r, people) {
  const nm = nameFn(people);
  return `${KIND_LABELS[r.kind]} ${r.days.map((x) => `${md(r.ym, x.day)} ${nm(r.a)} ${x.aCode || "空白"}↔${nm(r.b)} ${x.bCode || "空白"}`).join("、")}`;
}
const staffIds = (people) => people.filter((p) => p.active && p.role !== "employee").map((p) => p.id);
function opRequestSwap(s, reqs, inp, actor, now, today) {
  const id = newId();
  const plan = planEmpSwap(s, inp, id, actor, now, today);
  if (plan.hard.length) return { plan, reqs, req: null, notices: [] };
  const req = {
    id,
    ym: inp.ym,
    kind: inp.kind,
    a: inp.a,
    b: inp.b,
    give: plan.give,
    take: plan.take,
    days: plan.days,
    note: inp.note,
    warnings: plan.soft,
    status: "pending",
    at: now
  };
  const out = clone(reqs);
  out.items.push(req);
  const nm = nameFn(s.people);
  return { plan, reqs: out, req, notices: [notice(inp.b, `${nm(inp.a)} 想跟你換班：${describeReq(req, s.people)}，請到「我的班」回覆`, now)] };
}
function opAcceptSwap(s, reqs, id, me, actor, now, today) {
  const out = clone(reqs);
  const r = out.items.find((x) => x.id === id);
  if (!r || r.b !== me) throw new Error("找不到這筆換班申請");
  if (r.status !== "pending") throw new Error("這筆申請已經處理過了");
  const nm = nameFn(s.people);
  const fail = (why) => {
    r.status = "failed";
    r.decidedAt = now;
    r.reason = why;
    const p2 = emptyPatch();
    p2.notices.push(notice(r.a, `你跟 ${nm(r.b)} 的換班沒有成立：${why}`, now));
    return { patch: p2, reqs: out, error: why };
  };
  let plan;
  try {
    plan = planEmpSwap(s, { ym: r.ym, kind: r.kind, a: r.a, b: r.b, give: r.give, take: r.take, note: r.note }, r.id, actor, now, today);
  } catch (e) {
    return fail(e.message);
  }
  const same2 = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!same2(plan.days, r.days)) return fail("申請後班表已變動，請重新提出");
  if (plan.hard.length) return fail(plan.hard.join("；"));
  r.status = "done";
  r.decidedAt = now;
  r.warnings = plan.soft;
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
function opCloseSwap(s, reqs, id, me, how, now) {
  const out = clone(reqs);
  const r = out.items.find((x) => x.id === id);
  if (!r || (how === "rejected" ? r.b : r.a) !== me) throw new Error("找不到這筆換班申請");
  if (r.status !== "pending") throw new Error("這筆申請已經處理過了");
  r.status = how;
  r.decidedAt = now;
  const nm = nameFn(s.people);
  const text = describeReq(r, s.people);
  return {
    reqs: out,
    notices: [how === "rejected" ? notice(r.a, `${nm(r.b)} 婉拒了換班：${text}`, now) : notice(r.b, `${nm(r.a)} 撤回了換班申請：${text}`, now)]
  };
}
function stateOf(docs) {
  const byPrefix = (prefix) => Object.fromEntries(
    Object.keys(docs).filter((k) => k.startsWith(prefix) && docs[k]).map((k) => [k.slice(prefix.length), clone(docs[k])])
  );
  const get = (k, d) => clone(docs[k] ?? d);
  return {
    people: get("people", []),
    shifts: get("shifts", DEFAULT_SHIFTS),
    quotaItems: get("quotaItems", DEFAULT_QUOTA_ITEMS),
    rules: get("rules", DEFAULT_RULES),
    holidays: get("holidays", { days: {}, workdays: [], cny: [] }),
    holidayDuty: get("holidayDuty", {}),
    duty84: get("duty84", { log: [], removedDates: [], addedDates: [] }),
    cny: get("cny", { lastD: {}, log: [] }),
    debts: get("debts", []),
    months: byPrefix("month:"),
    prebooks: byPrefix("prebook:")
  };
}
function docsOfPatch(docs, p, now) {
  const out = {};
  for (const m of p.months) out[`month:${m.ym}`] = m;
  for (const pb of p.prebooks) out[`prebook:${pb.ym}`] = pb;
  if (p.duty84) out.duty84 = p.duty84;
  if (p.cny) out.cny = p.cny;
  if (p.debts) out.debts = p.debts;
  if (p.notices.length) out.notices = [...docs.notices ?? [], ...p.notices];
  for (const e of p.ests) out[`est:${e.ym}`] = e;
  for (const l of p.logs) {
    const k = `log:${l.scope}`;
    const d = out[k] ?? clone(docs[k] ?? { key: l.scope, entries: [] });
    d.entries.push({ at: now, actor: l.actor, action: l.action, detail: l.detail });
    if (d.entries.length > 2e3) d.entries.splice(0, d.entries.length - 2e3);
    out[k] = d;
  }
  return out;
}
export {
  HARD_RULES,
  KIND_LABELS,
  describeReq,
  docsOfPatch,
  gridCtxOf,
  opAcceptSwap,
  opCloseSwap,
  opRequestSwap,
  planEmpSwap,
  stateOf
};
