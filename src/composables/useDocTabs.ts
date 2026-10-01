import { reactive, computed, watch } from "vue";
import { readTextFile, writeTextFile, readFile, writeFile, mkdir, exists, stat, watch as fsWatch, copyFile, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { dirname, join, basename } from "@tauri-apps/api/path";
import { getDb, dbWrite } from "@/db";
import { wordCount } from "@/shared/manuscriptFiles";

/**
 * Markdown 文件頁的分頁與檔案（pending.md 第 3 階段）。
 * - 狀態放在模組層：離開頁面再回來，分頁、內容、未儲存的修改都還在
 * - 工作階段（開了哪些分頁、資料夾、最近文件、模式）存在 app_settings，重開 MedBase 時還原
 * - 未儲存的內容每 1.5 秒存一份草稿；意外關閉後重開，提示還原
 * - 監看檔案：外部修改時，沒有未儲存修改就直接重新載入，有的話讓使用者選
 */

export interface DocTab {
  id: string;
  /** null＝尚未存檔的新文件 */
  path: string | null;
  content: string;
  /** 最後一次與檔案一致的內容（判斷有沒有未儲存） */
  saved: string;
  mtime: number | null;
  source: boolean;
  cursor: number;
  /** 外部修改：changed＝檔案被其他程式改了、deleted＝檔案不見了 */
  external: "changed" | "deleted" | null;
  /** 意外關閉留下的草稿（與檔案內容不同時才有） */
  recover: string | null;
  untitledNo: number;
}

const SESSION_KEY = "md_docs_session";
const DRAFT_PREFIX = "md_draft:";
const MAX_RECENT = 15;

export const docs = reactive({
  tabs: [] as DocTab[],
  activeId: null as string | null,
  folder: null as string | null,
  recent: [] as string[],
  autosave: false,
  focus: false,
  typewriter: false,
  loaded: false,
  notice: "",
});

const newId = () => Math.random().toString(36).slice(2, 10);
export const isDirty = (t: DocTab) => t.content !== t.saved;
export const activeTab = computed(() => docs.tabs.find(t => t.id === docs.activeId) ?? null);
export const anyDirty = computed(() => docs.tabs.some(isDirty));

export function tabTitle(t: DocTab): string {
  if (!t.path) return `未命名 ${t.untitledNo}`;
  return t.path.split(/[\\/]/).pop() ?? t.path;
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
export function notify(msg: string) {
  docs.notice = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { docs.notice = ""; }, 3500);
}

// ── app_settings ────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}
const setSetting = (key: string, value: string) =>
  dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [key, value]);
const delSetting = (key: string) => dbWrite("DELETE FROM app_settings WHERE key = ?", [key]);

const draftKey = (t: DocTab) => DRAFT_PREFIX + (t.path ?? `untitled:${t.id}`);

// ── 工作階段 ─────────────────────────────────────────────────────

interface Session {
  tabs: { id: string; path: string | null; cursor: number; source: boolean; untitledNo: number }[];
  active: string | null; folder: string | null; recent: string[];
  autosave: boolean; focus: boolean; typewriter: boolean;
}

let sessionTimer: ReturnType<typeof setTimeout> | null = null;
function saveSession() {
  if (!docs.loaded) return;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    const s: Session = {
      tabs: docs.tabs.map(t => ({ id: t.id, path: t.path, cursor: t.cursor, source: t.source, untitledNo: t.untitledNo })),
      active: docs.activeId, folder: docs.folder, recent: docs.recent,
      autosave: docs.autosave, focus: docs.focus, typewriter: docs.typewriter,
    };
    setSetting(SESSION_KEY, JSON.stringify(s)).catch(() => {});
  }, 500);
}

let loading: Promise<void> | null = null;
/** 第一次進入頁面時還原上次的分頁 */
export function loadSession(): Promise<void> {
  loading ??= (async () => {
    try {
      const raw = await getSetting(SESSION_KEY);
      const s: Partial<Session> = raw ? JSON.parse(raw) : {};
      docs.folder = s.folder ?? null;
      docs.recent = s.recent ?? [];
      docs.autosave = !!s.autosave;
      docs.focus = !!s.focus;
      docs.typewriter = !!s.typewriter;
      for (const st of s.tabs ?? []) {
        if (st.path) {
          const t = await loadTab(st.path, st.id);
          if (t) { t.cursor = st.cursor; t.source = st.source; docs.tabs.push(t); }
          else notify(`找不到上次開啟的檔案：${st.path}`);
        } else {
          // 未命名文件只靠草稿還原
          const draft = await getSetting(`${DRAFT_PREFIX}untitled:${st.id}`);
          if (draft) {
            const d = JSON.parse(draft) as { content: string };
            docs.tabs.push(makeTab({ id: st.id, path: null, content: d.content, saved: "", untitledNo: st.untitledNo }));
          }
        }
      }
      docs.activeId = docs.tabs.some(t => t.id === s.active) ? s.active! : docs.tabs[0]?.id ?? null;
      docs.tabs.forEach(startWatch);
    } catch (e) {
      notify(`還原上次的文件失敗：${(e as Error).message}`);
    } finally {
      docs.loaded = true;
    }
  })();
  return loading;
}

watch(() => [docs.tabs.map(t => `${t.id}${t.path}${t.source}`).join(), docs.activeId, docs.folder, docs.recent.join(), docs.autosave, docs.focus, docs.typewriter], saveSession);

// ── 分頁 ─────────────────────────────────────────────────────────

function makeTab(p: Partial<DocTab> & { content: string; saved: string }): DocTab {
  return reactive({
    id: p.id ?? newId(), path: p.path ?? null, content: p.content, saved: p.saved, mtime: p.mtime ?? null,
    source: p.source ?? false, cursor: p.cursor ?? 0, external: null, recover: p.recover ?? null,
    untitledNo: p.untitledNo ?? 0,
  }) as DocTab;
}

async function mtimeOf(path: string): Promise<number | null> {
  try { return (await stat(path)).mtime?.getTime() ?? null; } catch { return null; }
}

async function loadTab(path: string, id?: string): Promise<DocTab | null> {
  if (!(await exists(path))) return null;
  const content = (await readTextFile(path)).replace(/\r\n/g, "\n");
  const t = makeTab({ id, path, content, saved: content, mtime: await mtimeOf(path) });
  const draft = await getSetting(draftKey(t));
  if (draft) {
    const d = JSON.parse(draft) as { content: string };
    if (d.content !== content) t.recover = d.content;
    else await delSetting(draftKey(t));
  }
  return t;
}

function pushRecent(path: string) {
  docs.recent = [path, ...docs.recent.filter(p => p !== path)].slice(0, MAX_RECENT);
}

export function activate(id: string) {
  docs.activeId = id;
}

export function newDoc(content = "") {
  const no = Math.max(0, ...docs.tabs.filter(t => !t.path).map(t => t.untitledNo)) + 1;
  const t = makeTab({ content, saved: "", untitledNo: no });
  docs.tabs.push(t);
  docs.activeId = t.id;
  return t;
}

/** 開啟檔案：已開過就切過去（同一份文件只開一個分頁） */
export async function openPath(path: string): Promise<DocTab | null> {
  const same = docs.tabs.find(t => t.path && samePath(t.path, path));
  if (same) { docs.activeId = same.id; pushRecent(path); return same; }
  try {
    const t = await loadTab(path);
    if (!t) { notify(`找不到檔案：${path}`); docs.recent = docs.recent.filter(p => p !== path); return null; }
    // 目前分頁是空白未命名文件時直接取代
    const cur = activeTab.value;
    if (cur && !cur.path && !cur.content) docs.tabs.splice(docs.tabs.indexOf(cur), 1, t);
    else docs.tabs.push(t);
    docs.activeId = t.id;
    pushRecent(path);
    startWatch(t);
    return t;
  } catch (e) {
    notify(`開啟失敗：${(e as Error).message}`);
    return null;
  }
}

const samePath = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

const MD_FILTER = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];

export async function openWithDialog() {
  const picked = await openDialog({ title: "開啟 Markdown 文件", multiple: true, filters: MD_FILTER, defaultPath: docs.folder ?? undefined });
  const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
  for (const p of list) await openPath(p);
}

// ── 存檔 ─────────────────────────────────────────────────────────

/** 自己寫檔後短時間內的監看事件忽略 */
const selfWrites = new Map<string, number>();

export async function saveTab(t: DocTab, as = false): Promise<boolean> {
  let path = t.path;
  if (!path || as) {
    const suggested = path ?? (docs.folder ? await join(docs.folder, `${firstHeading(t.content) || tabTitle(t)}.md`) : `${firstHeading(t.content) || tabTitle(t)}.md`);
    const p = await saveDialog({ title: as ? "另存新檔" : "儲存文件", defaultPath: suggested, filters: MD_FILTER });
    if (!p) return false;
    path = p;
  }
  try {
    const content = t.content;
    selfWrites.set(path, Date.now());
    await writeTextFile(path, content);
    const oldKey = draftKey(t);
    const moved = t.path !== path;
    if (moved) stopWatch(t);
    t.path = path;
    t.saved = content;
    t.mtime = await mtimeOf(path);
    t.external = null;
    t.recover = null;
    await delSetting(oldKey);
    if (moved) { await delSetting(draftKey(t)); startWatch(t); }
    pushRecent(path);
    return true;
  } catch (e) {
    notify(`儲存失敗：${(e as Error).message}`);
    return false;
  }
}

function firstHeading(md: string): string {
  const m = /^#{1,6}\s+(.+)$/m.exec(md);
  return (m?.[1] ?? "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60);
}

/** 關閉分頁（未儲存的確認由頁面處理）；回傳下一個作用中的分頁 */
export async function closeTab(t: DocTab, discardDraft = true) {
  const i = docs.tabs.indexOf(t);
  if (i < 0) return;
  stopWatch(t);
  if (discardDraft) await delSetting(draftKey(t)).catch(() => {});
  docs.tabs.splice(i, 1);
  if (docs.activeId === t.id) docs.activeId = docs.tabs[Math.min(i, docs.tabs.length - 1)]?.id ?? null;
}

export function moveTab(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= docs.tabs.length || to >= docs.tabs.length) return;
  const [t] = docs.tabs.splice(from, 1);
  docs.tabs.splice(to, 0, t);
}

// ── 編輯：草稿與自動儲存 ─────────────────────────────────────────

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function onEdited(t: DocTab, content: string) {
  t.content = content;
  clearTimeout(draftTimers.get(t.id));
  draftTimers.set(t.id, setTimeout(() => {
    if (isDirty(t)) setSetting(draftKey(t), JSON.stringify({ content: t.content, at: Date.now() })).catch(() => {});
    else delSetting(draftKey(t)).catch(() => {});
  }, 1500));
  if (docs.autosave && t.path && !t.external) {
    clearTimeout(autoTimers.get(t.id));
    autoTimers.set(t.id, setTimeout(() => { if (isDirty(t)) saveTab(t); }, 1200));
  }
}

export async function acceptRecover(t: DocTab, use: boolean) {
  if (use && t.recover != null) onEdited(t, t.recover);
  else await delSetting(draftKey(t));
  t.recover = null;
}

// ── 外部修改 ─────────────────────────────────────────────────────

const watchers = new Map<string, UnwatchFn>();

async function startWatch(t: DocTab) {
  if (!t.path || watchers.has(t.id)) return;
  const path = t.path;
  try {
    const un = await fsWatch(path, () => { checkExternal(t); }, { delayMs: 400 });
    if (t.path === path && docs.tabs.includes(t)) watchers.set(t.id, un);
    else un();
  } catch { /* 監看失敗時仍有切回視窗時的檢查 */ }
}

function stopWatch(t: DocTab) {
  watchers.get(t.id)?.();
  watchers.delete(t.id);
}

/** 檢查檔案是否被其他程式修改（監看事件、切回視窗時呼叫） */
export async function checkExternal(t: DocTab) {
  if (!t.path) return;
  const path = t.path;
  const self = selfWrites.get(path);
  if (self && Date.now() - self < 2000) return;
  if (!(await exists(path))) { t.external = "deleted"; return; }
  const m = await mtimeOf(path);
  if (m !== null && m === t.mtime) return;
  const disk = (await readTextFile(path)).replace(/\r\n/g, "\n");
  t.mtime = m;
  if (disk === t.saved) return;
  if (!isDirty(t)) {
    t.content = disk;
    t.saved = disk;
    t.external = null;
    notify(`「${tabTitle(t)}」已在外部修改，已重新載入`);
  } else {
    t.external = "changed";
  }
}

export const checkAllExternal = () => Promise.all(docs.tabs.map(checkExternal));

/** 外部修改的處理：reload＝改用檔案的版本、keep＝保留我的版本（下次存檔覆蓋） */
export async function resolveExternal(t: DocTab, choice: "reload" | "keep") {
  if (choice === "reload" && t.path && (await exists(t.path))) {
    const disk = (await readTextFile(t.path)).replace(/\r\n/g, "\n");
    t.content = disk;
    t.saved = disk;
    t.mtime = await mtimeOf(t.path);
  }
  // keep：保留編輯中的內容，下次存檔覆蓋檔案；檔案被刪除時標成未儲存，提醒要存回去
  if (choice === "keep" && t.external === "deleted" && !isDirty(t)) t.saved = t.content ? "" : "\n";
  t.external = null;
}

// ── 圖片 ─────────────────────────────────────────────────────────

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };
const blobCache = new Map<string, string>();

/** 文件內的相對路徑圖片 → blob 網址 */
export async function resolveDocImage(t: DocTab, src: string): Promise<string> {
  if (!t.path) return "";
  const rel = decodeURI(src.replace(/^<|>$/g, ""));
  const abs = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(rel) ? rel : await join(await dirname(t.path), rel);
  const cached = blobCache.get(abs);
  if (cached) return cached;
  const bytes = await readFile(abs);
  const ext = abs.split(".").pop()?.toLowerCase() ?? "";
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
  blobCache.set(abs, url);
  return url;
}

async function assetsDir(t: DocTab): Promise<string> {
  const dir = await join(await dirname(t.path!), "assets");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "image";

/** 貼上／拖入的圖片存到文件旁的 assets 資料夾，回傳相對路徑 */
export async function saveDocImage(t: DocTab, file: File): Promise<string | null> {
  if (!t.path) throw new Error("請先儲存文件，圖片會放在文件旁的 assets 資料夾");
  const dir = await assetsDir(t);
  const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase();
  const base = (await basename(t.path)).replace(/\.[^.]+$/, "");
  const name = `${safe(base)}-${stamp()}-${Math.random().toString(36).slice(2, 5)}.${ext}`;
  await writeFile(await join(dir, name), new Uint8Array(await file.arrayBuffer()));
  return `assets/${name}`;
}

/** 從檔案選擇插入圖片：複製到 assets 資料夾 */
export async function pickDocImage(t: DocTab): Promise<string | null> {
  if (!t.path) { notify("請先儲存文件，圖片會放在文件旁的 assets 資料夾"); return null; }
  const p = await openDialog({ title: "插入圖片", multiple: false, filters: [{ name: "圖片", extensions: Object.keys(MIME) }] }) as string | null;
  if (!p) return null;
  const dir = await assetsDir(t);
  const name = `${stamp()}-${safe(await basename(p))}`;
  await copyFile(p, await join(dir, name));
  return `assets/${name}`;
}

export const docStats = (t: DocTab) => ({ words: wordCount(t.content), chars: t.content.length, lines: t.content.split("\n").length });
