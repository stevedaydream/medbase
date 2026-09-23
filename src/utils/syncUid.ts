/**
 * 舊資料的跨電腦 uid。
 *
 * 升級前各電腦只有本地自動遞增 id，同一筆資料在不同電腦 id 不同。若各自
 * 產生隨機 uid，同步後每筆都會重複一份。改由「表名＋名稱」算出固定值，
 * 同名資料在每台電腦得到相同 uid；同名多筆依 id 順序加序號區分。
 */
function fnv1a32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function legacyUid(table: string, naturalKey: string, dupIndex: number): string {
  const text = `${table}\u0001${naturalKey.trim()}\u0001${dupIndex}`;
  const a = fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a32(text, 0x01234567).toString(16).padStart(8, "0");
  return `legacy-${a}${b}`;
}
