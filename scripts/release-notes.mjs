// 發布說明：整理上一個版本 tag 到 HEAD 的 commit，依類型分組（release.bat 選項 1 使用）
//   node scripts/release-notes.mjs <新版號>           產生 release-notes.md 並印出
//   node scripts/release-notes.mjs --commit-msg <版號>  依 release-notes.md 產生 .git/RELEASE_COMMIT_MSG
// release-notes.md 不進 git（.gitignore 的 *.md），使用者可先用記事本修改再發布。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NOTES = "release-notes.md";
const COMMIT_MSG = ".git/RELEASE_COMMIT_MSG";

const GROUPS = [
  { types: ["feat"], title: "新功能" },
  { types: ["fix"], title: "修正" },
  { types: ["perf"], title: "效能改善" },
  { types: ["refactor", "style"], title: "其他調整" },
];
/** 同仁不需要看到的 commit */
const SKIP = ["chore", "docs", "test", "merge", "ci", "build"];
const SCOPES = {
  sched: "排班", sdm: "SDM", mobile: "手機", md: "Markdown", memo: "備忘錄", sets: "套組", items: "自費品項",
  research: "論文", handbook: "工作手冊", emergency: "數值判讀", gas: "雲端", style: "畫面", acp: "ACP",
};

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function previousTag() {
  try { return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", "HEAD"); } catch { return ""; }
}

export function buildNotes(subjects) {
  const groups = new Map(GROUPS.map(g => [g.title, []]));
  const seen = new Set();
  for (const s of subjects) {
    const m = s.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    if (!m) continue;
    const [, type, scope, desc] = m;
    if (SKIP.includes(type)) continue;
    const g = GROUPS.find(x => x.types.includes(type));
    if (!g) continue;
    const label = scope ? `${SCOPES[scope] ?? scope}：` : "";
    const line = `- ${label}${desc.trim()}`;
    if (seen.has(line)) continue;
    seen.add(line);
    groups.get(g.title).push(line);
  }
  const parts = [...groups].filter(([, l]) => l.length).map(([t, l]) => `## ${t}\n${l.join("\n")}`);
  return parts.length ? parts.join("\n\n") : "（本版沒有功能變更）";
}

const args = process.argv.slice(2);
if (args[0] === "--commit-msg") {
  const ver = args[1];
  const notes = readFileSync(NOTES, "utf8").replace(/^﻿/, "").trim();
  writeFileSync(COMMIT_MSG, `chore: 發布 v${ver}\n\n${notes}\n`);
} else if (args[0] && !args[0].startsWith("-")) {
  const ver = args[0];
  const prev = previousTag();
  const range = prev ? `${prev}..HEAD` : "HEAD";
  const subjects = git("log", "--no-merges", "--reverse", "--format=%s", range).split("\n").filter(Boolean);
  const notes = buildNotes(subjects);
  writeFileSync(NOTES, notes + "\n");
  console.log(`\n===== v${ver} 發布說明（${prev ? `自 ${prev} 起` : "全部"}，${subjects.length} 個 commit）=====\n`);
  console.log(notes);
  console.log(`\n===== 已存成 ${NOTES} =====`);
}
