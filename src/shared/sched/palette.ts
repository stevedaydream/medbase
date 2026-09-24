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
];

export function colorOf(key: string) {
  return COLOR_PALETTE.find(c => c.key === key) ?? COLOR_PALETTE[3];
}
