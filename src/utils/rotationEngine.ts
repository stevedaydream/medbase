/**
 * 輪序引擎 — TypeScript 版
 * 移植自 rotationEngine.js，加入 quota 欄位與月份投影功能
 */

export interface RotationPool {
  poolName: string;   // 例：'satD'
  label: string;      // 例：'週六白班'
  shiftCode: string;  // 例：'D'（填入班表格的班別代碼）
  quota: number;      // 每日應派人數（預設 1）
  order: string[];    // 員工 code 輪序陣列
  lastIndex: number;  // 上次指派到的 index（-1 = 尚未開始）
  skipQueue: string[]; // 暫時跳過的員工 code
}

export interface ProjectedCell {
  code: string;
  fromPool: string;
  shiftCode: string;
}

/** key = `${day}-${poolName}` (1-based day) */
export type ProjectionMap = Map<string, ProjectedCell[]>;

/**
 * 從輪序池取得下 quota 人（跳過 skipCodes）
 * 純計算，不修改傳入的 pool 物件
 */
export function getNextFromPool(
  pool: Pick<RotationPool, 'order' | 'lastIndex'>,
  quota: number,
  skipCodes: string[]
): { codes: string[]; newLastIndex: number } {
  const { order, lastIndex } = pool;
  if (!order.length) return { codes: [], newLastIndex: lastIndex };

  const result: string[] = [];
  let newLastIndex = lastIndex;
  let idx = (lastIndex + 1) % order.length;
  let attempts = 0;

  while (result.length < quota && attempts < order.length) {
    const code = order[idx];
    if (!skipCodes.includes(code)) {
      result.push(code);
      newLastIndex = idx;
    }
    idx = (idx + 1) % order.length;
    attempts++;
  }

  return { codes: result, newLastIndex };
}

/**
 * 計算指定月份的輪序投影（唯讀，不修改 pools）
 * 支援 sat* / sun* / wd* 池（假日池暫不處理，無外部假日 API）
 */
export function runProjection(
  pools: RotationPool[],
  year: number,
  month: number    // 1-based
): ProjectionMap {
  const daysInMonth = new Date(year, month, 0).getDate();
  const result: ProjectionMap = new Map();

  // 深拷貝，模擬推進不影響原始池狀態
  const sim: RotationPool[] = pools.map(p => ({
    ...p,
    order:     [...p.order],
    skipQueue: [...(p.skipQueue ?? [])],
  }));

  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month - 1, day).getDay(); // 0=Sun, 6=Sat
    const isSat = dow === 6;
    const isSun = dow === 0;

    const dayAssigned: string[] = [];

    for (const pool of sim) {
      if (!pool.order.length) continue;
      const pn = pool.poolName;
      const fires =
        (isSat  && pn.startsWith('sat')) ||
        (isSun  && pn.startsWith('sun')) ||
        (!isSat && !isSun && pn.startsWith('wd'));
      if (!fires) continue;

      const { codes, newLastIndex } = getNextFromPool(pool, pool.quota, dayAssigned);
      if (codes.length) {
        pool.lastIndex = newLastIndex;
        result.set(`${day}-${pn}`, codes.map(c => ({
          code: c, fromPool: pn, shiftCode: pool.shiftCode,
        })));
        dayAssigned.push(...codes);
      }
    }
  }

  return result;
}

/** 預設輪序池（不含成員） */
export const DEFAULT_POOLS: RotationPool[] = [
  { poolName: 'satD',  label: '週六白班', shiftCode: 'D',   quota: 1, order: [], lastIndex: -1, skipQueue: [] },
  { poolName: 'satN',  label: '週六夜班', shiftCode: 'N',   quota: 1, order: [], lastIndex: -1, skipQueue: [] },
  { poolName: 'sunD',  label: '週日白班', shiftCode: 'D',   quota: 1, order: [], lastIndex: -1, skipQueue: [] },
  { poolName: 'sunN',  label: '週日夜班', shiftCode: 'N',   quota: 1, order: [], lastIndex: -1, skipQueue: [] },
  { poolName: 'holD',  label: '假日白班', shiftCode: 'D',   quota: 1, order: [], lastIndex: -1, skipQueue: [] },
  { poolName: 'holN',  label: '假日夜班', shiftCode: 'N',   quota: 1, order: [], lastIndex: -1, skipQueue: [] },
  { poolName: 'wdOff', label: '平日 Off', shiftCode: 'Off', quota: 1, order: [], lastIndex: -1, skipQueue: [] },
];
