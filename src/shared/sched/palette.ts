/** 班別配色（沿用舊排班頁色票，班表格底色／字色） */
export const COLOR_PALETTE = [
  { key: "blue",    bg: "#1e3a5f", text: "#93c5fd" },
  { key: "violet",  bg: "#2e1065", text: "#c4b5fd" },
  { key: "emerald", bg: "#064e3b", text: "#6ee7b7" },
  { key: "gray",    bg: "#374151", text: "#9ca3af" },
  { key: "red",     bg: "#7f1d1d", text: "#fca5a5" },
  { key: "orange",  bg: "#431407", text: "#fb923c" },
  { key: "yellow",  bg: "#422006", text: "#fcd34d" },
  { key: "pink",    bg: "#500724", text: "#f9a8d4" },
  { key: "cyan",    bg: "#0c4a6e", text: "#7dd3fc" },
  { key: "rose",    bg: "#4c0519", text: "#fda4af" },
  { key: "amber",   bg: "#451a03", text: "#fbbf24" },
  { key: "lime",    bg: "#1a2e05", text: "#bef264" },
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
