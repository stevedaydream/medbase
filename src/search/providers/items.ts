import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** 自費品項（可直接複製院內碼） */
export default {
  key: "items",
  tables: ["items"],
  async load() {
    const db = await getDb();
    const rows = await db.select<{ hospital_code: string; name_zh: string | null; name_en: string | null; purpose: string | null; price: number | null; supplier: string | null }[]>(
      "SELECT hospital_code, name_zh, name_en, purpose, price, supplier FROM items");
    return rows.map(m => ({
      type: "自費", label: m.name_zh || m.name_en || m.hospital_code,
      sub: [m.hospital_code, m.purpose, m.price ? `$${m.price.toLocaleString()}` : ""].filter(Boolean).join(" · "),
      keywords: [m.name_en, m.supplier].filter(Boolean).join(" "),
      route: focusRoute("/items", "items", m.hospital_code),
      copy: { text: m.hospital_code, label: "複製碼" },
    }));
  },
} satisfies SearchProvider;
