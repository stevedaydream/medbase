/** 班別配色（淺色底＋深色字，班表格底色／字色） */
export const COLOR_PALETTE = [
  { key: "blue",    bg: "#bfdbfe", text: "#1e3a8a" },
  { key: "violet",  bg: "#ddd6fe", text: "#4c1d95" },
  { key: "emerald", bg: "#a7f3d0", text: "#064e3b" },
  { key: "gray",    bg: "#e5e7eb", text: "#374151" },
  { key: "red",     bg: "#fecaca", text: "#7f1d1d" },
  { key: "orange",  bg: "#fed7aa", text: "#7c2d12" },
  { key: "yellow",  bg: "#fef08a", text: "#713f12" },
  { key: "pink",    bg: "#fbcfe8", text: "#831843" },
  { key: "cyan",    bg: "#a5f3fc", text: "#164e63" },
  { key: "rose",    bg: "#fecdd3", text: "#881337" },
  { key: "amber",   bg: "#fde68a", text: "#78350f" },
  { key: "lime",    bg: "#d9f99d", text: "#365314" },
];

export function colorOf(key: string) {
  return COLOR_PALETTE.find(c => c.key === key) ?? COLOR_PALETTE[3];
}

/** 個人自選班別顏色（手機，跟著帳號存雲端）：班別代號 → 底色與字色 */
export type ShiftColorPrefs = Record<string, { bg: string; text: string }>;

export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** 依底色亮度自動配黑或白字 */
export function textOn(bg: string): string {
  if (!isHexColor(bg)) return "#ffffff";
  const [r, g, b] = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111827" : "#ffffff";
}
