/**
 * 網頁開發版的資料庫（只在 `npm run dev` 的一般瀏覽器使用，不會進正式版）。
 *
 * Tauri 的 plugin-sql 要呼叫 Rust 後端，一般瀏覽器裡沒有，畫面一讀資料庫就失敗。
 * 這裡用 sql.js（瀏覽器裡的 SQLite）提供同樣的 select／execute 介面：
 *   - 每次開頁面都向開發伺服器要一份「本機真實資料庫」的快照（vite.config.ts 的 devRealDb）
 *   - 修改只留在這次開啟的記憶體裡，重新整理就回到真實資料，絕不寫回真實資料庫
 *   - 雲端網址與金鑰清空、並擋下對 GAS 的連線，避免網頁版的修改同步到全院
 */
import initSqlJs, { type Database as SqlJsDb, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export interface QueryResult { rowsAffected: number; lastInsertId?: number }

/** 雲端相關設定：快照載入後清空，網頁版不連雲端 */
const CLOUD_KEYS = ["scheduler_gas_url", "gas_api_key"];
const BLOCKED_HOSTS = ["script.google.com", "script.googleusercontent.com"];

export type WebDbSource = "real" | "empty";
export const webDbInfo: { source: WebDbSource; note: string } = { source: "empty", note: "" };

function toBind(params: unknown[]): SqlValue[] {
  return params.map(p => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (typeof p === "number" || typeof p === "string" || p instanceof Uint8Array) return p;
    if (typeof p === "bigint") return Number(p);
    return typeof p === "object" ? JSON.stringify(p) : String(p);
  });
}

function blockCloud() {
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      if (BLOCKED_HOSTS.includes(new URL(url, location.href).hostname)) {
        return Promise.reject(new Error("網頁開發版不連雲端（避免把測試修改同步到全院）"));
      }
    } catch { /* 相對路徑等，照常 */ }
    return orig(input, init);
  };
}

export class WebDatabase {
  private constructor(private db: SqlJsDb) {}

  static async load(_path: string): Promise<WebDatabase> {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    let db: SqlJsDb;
    try {
      const res = await fetch("/__dev/medbase.db", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      webDbInfo.source = "real";
      webDbInfo.note = res.headers.get("X-MedBase-Db") ?? "";
    } catch (e) {
      db = new SQL.Database();
      webDbInfo.source = "empty";
      webDbInfo.note = (e as Error).message;
    }
    const wdb = new WebDatabase(db);
    // 空白資料庫此時還沒有 app_settings（稍後 initSchema 才建）
    try { for (const k of CLOUD_KEYS) wdb.db.run("UPDATE app_settings SET value = '' WHERE key = ?", [k]); } catch { /* 無此表 */ }
    blockCloud();
    console.info(
      `[網頁開發版] 資料庫：${webDbInfo.source === "real" ? `本機真實資料快照 ${webDbInfo.note}` : `空白資料庫（${webDbInfo.note}）`}；修改只在這個分頁，重新整理即還原，不連雲端`,
    );
    return wdb;
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const stmt = this.db.prepare(query);
    try {
      stmt.bind(toBind(bindValues));
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows as T;
    } finally {
      stmt.free();
    }
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<QueryResult> {
    if (bindValues.length) this.db.run(query, toBind(bindValues));
    else this.db.exec(query); // 無參數時允許一次多個敘述（建表、PRAGMA）
    const id = this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
    return { rowsAffected: this.db.getRowsModified(), lastInsertId: typeof id === "number" ? id : undefined };
  }

  async close(): Promise<boolean> {
    this.db.close();
    return true;
  }
}
