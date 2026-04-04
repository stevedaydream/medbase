/**
 * MedBase 本地資料解析腳本
 * 將 data/ 資料夾中的三個檔案轉換為可匯入格式
 *
 * 執行方式：node scripts/parse-data.js
 * 輸出：data/items_parsed.xlsx、data/physicians_parsed.xlsx
 */

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DATA_DIR = path.join(__dirname, "../data");

// ─────────────────────────────────────────────────────────────────────────────
// 共用工具
// ─────────────────────────────────────────────────────────────────────────────

function parsePrice(raw) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).replace(/[,，\s]/g, "");
  const m = s.match(/[\d]+/);
  return m ? parseInt(m[0], 10) : 0;
}

function cleanName(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 解析 9A自費本.xls — 骨科/外科自費醫材
// ─────────────────────────────────────────────────────────────────────────────

function parseXlsItems() {
  console.log("\n[1] 解析 9A自費本.xls...");
  const wb = XLSX.readFile(path.join(DATA_DIR, "20250803 9A自費本.xls"));
  const items = [];

  // 各工作表的科別/廠商對應
  const sheetCategory = {
    "國泰改版": "骨科",
    "崔棟": "骨科/信迪思",
    "崔棟2": "骨科/信迪思",
    "愛派司+人工骨": "骨科/愛派司",
    "韶田+Stryker": "骨科/韶田",
    "Zimmer+Joint": "骨科/人工關節",
    "Arthoroscopy": "骨科/關節鏡",
    "Spine": "脊椎/Spine",
    "PS(1)": "整形外科",
    "PS(2)": "整形外科",
    "Uro": "泌尿科",
    "Uro (2)": "泌尿科",
  };

  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });
    const category = sheetCategory[sheetName] || sheetName;

    // 找 header 列（含「中文名稱」或「代碼」的那行）
    let headerRow = -1;
    let colMap = { name: -1, english: -1, code: -1, price: -1 };

    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const row = rows[i].map((c) => String(c).trim());
      const hasName = row.findIndex((c) => c.includes("中文") || c.includes("名稱"));
      const hasCode = row.findIndex((c) => c.includes("代碼") || c.includes("院內碼"));
      const hasPrice = row.findIndex((c) => c.includes("收費") || c.includes("價錢") || c.includes("價格"));
      const hasEng = row.findIndex((c) => c.includes("英文"));

      if (hasCode !== -1 || hasPrice !== -1) {
        headerRow = i;
        colMap.name = hasName !== -1 ? hasName : 0;
        colMap.english = hasEng !== -1 ? hasEng : -1;
        colMap.code = hasCode !== -1 ? hasCode : -1;
        colMap.price = hasPrice !== -1 ? hasPrice : -1;
        break;
      }
    }

    if (headerRow === -1) {
      // 沒有標準 header，嘗試 header=1 格式 (崔棟2)
      headerRow = 0;
      colMap = { name: 1, english: 0, code: 2, price: 3 };
    }

    // 取廠商名稱（第0列第0欄，通常是廠商或科別）
    const supplierRaw = rows[0] ? String(rows[0][0] || "").split("/")[0].trim() : "";
    const supplier = supplierRaw.length < 30 ? supplierRaw : "";

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      const nameCh = cleanName(row[colMap.name]);
      const nameEn = colMap.english >= 0 ? cleanName(row[colMap.english]) : "";
      const code = cleanName(row[colMap.code >= 0 ? colMap.code : 2]);
      const priceRaw = row[colMap.price >= 0 ? colMap.price : 3];
      const price = parsePrice(priceRaw);

      // 過濾空行與標題行
      if (!nameCh && !nameEn) continue;
      if (!code || !code.match(/M1[A-Z]/i)) continue;

      const name = nameCh || nameEn;
      const notes = nameEn && nameCh ? nameEn : "";

      items.push({ name, hospital_code: code, category, unit: "組", price, supplier, notes });
    }

    console.log(`  工作表「${sheetName}」: ${items.filter((x) => x.category === category).length} 筆`);
  });

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 解析外科自費器材.docx — ENT / GS / 整形 / 泌尿
// ─────────────────────────────────────────────────────────────────────────────

function parseDocxItems() {
  console.log("\n[2] 解析外科自費器材.docx...");

  // 讀取已存好的文字檔（由先前的 PowerShell 指令產生）
  const txtPath = path.join(DATA_DIR, "docx_text.txt");
  const raw = fs.readFileSync(txtPath, "utf8");
  // 檔案中用 literal \`n 分隔
  const tokens = raw
    .split(/`n|\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== "﻿");

  // 分類對照表（關鍵字 → 正式名稱）
  const CATS = [
    ["甲狀腺", "耳鼻喉科/甲狀腺"],
    ["蔡明霖乳房", "乳房外科"],
    ["乳癌術後衣", "乳房外科/術後衣"],
    ["腹腔鏡手術", "一般外科/腹腔鏡"],
    ["CBD stone", "一般外科/膽道"],
    ["傷口組織膠", "傷口處置/組織膠"],
    ["MESH", "一般外科/疝氣MESH"],
    ["Inguinal", "一般外科/疝氣MESH"],
    ["Ventral hernia", "一般外科/疝氣MESH"],
    ["臍疝氣", "一般外科/疝氣MESH"],
    ["黃顧問 MESH", "一般外科/疝氣MESH"],
    ["TAPP", "一般外科/疝氣MESH"],
    ["TEP", "一般外科/疝氣MESH"],
    ["陳主任常用", "一般外科/陳主任"],
    ["GS", "一般外科"],
    ["胸腔外科", "胸腔外科"],
    ["肺腫瘤冷凍", "胸腔外科/冷凍治療"],
    ["眼科", "眼科"],
    ["郭博誠", "眼科"],
    ["低渣代餐", "其他/術前準備"],
  ];

  const CODE_FULL_RE = /^M1[A-Z0-9]{5,}/i;
  const CODE_START_RE = /^M\d?$|^M1$/i;
  const PRICE_RE = /^\d{3,6}$/;
  const SKIP_TOKENS = new Set(["★", "名稱", "代碼", "價錢", "英文名稱", "中文名稱"]);

  // 第一步：把連續的碼片段合併
  // 例如 ["M1", "W60607"] → ["M1W60607"]
  const merged = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    // 開頭是 M1 片段或 M1XXXXX
    if (/^M1?$/i.test(t) || CODE_FULL_RE.test(t)) {
      let code = t;
      while (
        i + 1 < tokens.length &&
        /^[A-Z0-9\s]{1,8}$/i.test(tokens[i + 1]) &&
        !SKIP_TOKENS.has(tokens[i + 1]) &&
        !PRICE_RE.test(tokens[i + 1]) &&
        tokens[i + 1].length <= 8
      ) {
        i++;
        code += tokens[i];
      }
      code = code.replace(/\s/g, "");
      merged.push(code);
    } else {
      merged.push(t);
    }
    i++;
  }

  // 第二步：★ 分割為 items，每個 item 包含 [name_tokens..., code, price?]
  const items = [];
  let currentCategory = "一般外科";

  const blocks = [];
  let current = [];
  for (const tok of merged) {
    if (tok === "★") {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  if (current.length > 0) blocks.push(current);

  for (const block of blocks) {
    // 偵測分類標題（不含M1碼的 block 且第一個 token 是分類）
    const blockText = block.join(" ");
    const catMatch = CATS.find(([kw]) => blockText.includes(kw) && !block.some((t) => CODE_FULL_RE.test(t)));
    if (catMatch) {
      currentCategory = catMatch[1];
      continue;
    }

    // 更新 category（即使 block 中有碼，也先偵測標題 token）
    for (const tok of block) {
      const catUpd = CATS.find(([kw]) => tok === kw || (kw.length > 3 && tok.includes(kw)));
      if (catUpd && !CODE_FULL_RE.test(tok)) { currentCategory = catUpd[1]; }
    }

    // 找院內碼
    const codeIdx = block.findIndex((t) => CODE_FULL_RE.test(t));
    if (codeIdx === -1) continue;

    const code = block[codeIdx].replace(/\s/g, "");

    // 找價格（在碼之後的第一個純數字）
    let price = 0;
    for (let j = codeIdx + 1; j < block.length; j++) {
      const candidate = block[j].replace(/[,，]/g, "");
      if (PRICE_RE.test(candidate)) { price = parseInt(candidate, 10); break; }
    }

    // 名稱 = 碼之前所有 token，跳過純噪音
    const nameParts = block
      .slice(0, codeIdx)
      .filter((t) => !SKIP_TOKENS.has(t) && !PRICE_RE.test(t) && t.length > 1)
      .join("");
    const name = cleanName(nameParts);

    if (name && code) {
      items.push({ name, hospital_code: code, category: currentCategory, unit: "個", price, supplier: "", notes: "" });
    }
  }

  console.log(`  docx 解析: ${items.length} 筆`);
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 解析外科VS帳號密碼分機表.xlsx
// ─────────────────────────────────────────────────────────────────────────────

function parsePhysicians() {
  console.log("\n[3] 解析外科VS帳號密碼_常用分機表.xlsx...");
  const wb = XLSX.readFile(path.join(DATA_DIR, "外科VS his帳號密碼_常用分機表.xlsx"));

  // 工作表「總表」— 兩欄並排的醫師資料
  const ws = wb.Sheets["總表"];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });

  const physicians = [];
  const DEPT_MAP = { URO: "泌尿科", GS: "一般外科", PS: "整形外科", NS: "神經外科", CRS: "大腸直腸外科", ENT: "耳鼻喉科", OPH: "眼科" };

  // Row 0 = headers; Row 1+ = data (5 cols per person, 2 persons per row)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // Left person: col 0-4
    const leftName = cleanName(row[0]);
    if (leftName) {
      physicians.push({
        name: leftName,
        department: DEPT_MAP[String(row[4]).trim()] || String(row[4]).trim(),
        title: "主治醫師",
        ext: String(row[1] || "").trim(),
        his_account: String(row[2] || "").trim(),
        his_password: String(row[3] || "").trim(),
        phs_account: "",
        phs_password: "",
        notes: "",
      });
    }
    // Right person: col 5-9
    const rightName = cleanName(row[5]);
    if (rightName) {
      physicians.push({
        name: rightName,
        department: DEPT_MAP[String(row[9] || "").trim()] || String(row[9] || "").trim(),
        title: "主治醫師",
        ext: String(row[6] || "").trim(),
        his_account: String(row[7] || "").trim(),
        his_password: String(row[8] || "").trim(),
        phs_account: "",
        phs_password: "",
        notes: "",
      });
    }
  }

  console.log(`  醫師: ${physicians.length} 人`);

  // 工作表「工作表1」— 常用分機表
  const ws2 = wb.Sheets["工作表1"];
  const rows2 = XLSX.utils.sheet_to_json(ws2, { defval: "", header: 1 });
  const contacts = [];
  for (let i = 1; i < rows2.length; i++) {
    const row = rows2[i];
    if (row[0] && row[1]) contacts.push({ label: cleanName(row[0]), ext: String(row[1]).trim() });
    if (row[2] && row[3]) contacts.push({ label: cleanName(row[2]), ext: String(row[3]).trim() });
  }
  console.log(`  常用分機: ${contacts.length} 筆`);

  return { physicians, contacts };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 輸出 XLSX（供 NHI 匯入介面使用）
// ─────────────────────────────────────────────────────────────────────────────

function writeItemsXlsx(items) {
  const outPath = path.join(DATA_DIR, "items_parsed.xlsx");
  // 去重（同 hospital_code 只保留第一筆）
  const seen = new Set();
  const unique = items.filter((item) => {
    if (!item.hospital_code || seen.has(item.hospital_code)) return false;
    seen.add(item.hospital_code);
    return true;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(unique.map((i) => ({
    name: i.name,
    hospital_code: i.hospital_code,
    category: i.category,
    unit: i.unit,
    price: i.price,
    supplier: i.supplier,
    notes: i.notes,
  })));
  XLSX.utils.book_append_sheet(wb, ws, "自費品項");
  XLSX.writeFile(wb, outPath);
  console.log(`\n✓ 已輸出 ${unique.length} 筆自費品項 → ${outPath}`);
  return unique.length;
}

function writePhysiciansXlsx(physicians) {
  const outPath = path.join(DATA_DIR, "physicians_parsed.xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(physicians.map((p) => ({
    name: p.name,
    department: p.department,
    title: p.title,
    ext: p.ext,
    his_account: p.his_account,
    his_password: p.his_password,
    phs_account: p.phs_account,
    phs_password: p.phs_password,
    notes: p.notes,
  })));
  XLSX.utils.book_append_sheet(wb, ws, "醫師名單");
  XLSX.writeFile(wb, outPath);
  console.log(`✓ 已輸出 ${physicians.length} 位醫師 → ${outPath}`);
}

function writeContactsJson(contacts) {
  const outPath = path.join(DATA_DIR, "contacts_parsed.json");
  fs.writeFileSync(outPath, JSON.stringify(contacts, null, 2), "utf8");
  console.log(`✓ 已輸出 ${contacts.length} 筆常用分機 → ${outPath}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主程式
// ─────────────────────────────────────────────────────────────────────────────

console.log("=== MedBase 資料解析 ===");

const xlsItems = parseXlsItems();
const docxItems = parseDocxItems();
const allItems = [...xlsItems, ...docxItems];

const { physicians, contacts } = parsePhysicians();

console.log(`\n合計: ${allItems.length} 筆品項（去重前）, ${physicians.length} 位醫師`);

writeItemsXlsx(allItems);
writePhysiciansXlsx(physicians);
writeContactsJson(contacts);

console.log("\n=== 完成 ===");
console.log("後續步驟：");
console.log("  1. 在 MedBase 自費品項頁 → 點「匯入 XLSX」→ 選 data/items_parsed.xlsx");
console.log("  2. 在醫師通訊錄頁 → 點「批次匯入」→ 選 data/physicians_parsed.xlsx");
