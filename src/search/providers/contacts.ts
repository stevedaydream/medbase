import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** 通訊錄：人員與常用分機 */
export default {
  key: "contacts",
  tables: ["physicians", "contacts"],
  async load() {
    const db = await getDb();
    const [people, units] = await Promise.all([
      db.select<{ name: string; department: string | null; title: string | null; ext: string | null; his_account: string | null }[]>(
        "SELECT name, department, title, ext, his_account FROM physicians"),
      db.select<{ label: string; ext: string | null; category: string | null; notes: string | null }[]>(
        "SELECT label, ext, category, notes FROM contacts"),
    ]);
    return [
      ...people.map(m => ({
        type: "人員", label: m.name,
        sub: [m.department, m.title, m.ext ? `分機 ${m.ext}` : "", m.his_account ? `HIS ${m.his_account}` : ""].filter(Boolean).join(" · "),
        route: focusRoute("/physicians", "contacts", m.name),
      })),
      ...units.map(m => ({
        type: "分機", label: m.label, sub: [m.category, m.ext ? `分機 ${m.ext}` : ""].filter(Boolean).join(" · "),
        keywords: m.notes ?? "", route: focusRoute("/physicians", "contacts", m.label),
      })),
    ];
  },
} satisfies SearchProvider;
