// sql.js 沒有附型別，只宣告 webDb.ts 用到的部分
declare module "sql.js" {
  export type SqlValue = number | string | Uint8Array | null;
  export interface Statement {
    bind(values?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }
  export interface QueryExecResult { columns: string[]; values: SqlValue[][] }
  export interface Database {
    run(sql: string, params?: SqlValue[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    getRowsModified(): number;
    close(): void;
  }
  export interface SqlJsStatic { Database: new (data?: Uint8Array) => Database }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
