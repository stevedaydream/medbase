/**
 * 排班系統 GAS Web App — scheduler.gs
 * 部署方式：Google Sheet → 擴充功能 → Apps Script → 貼上全部內容 → 部署為 Web App
 * 執行身分：我，存取：任何人
 */

// ─────────────────────────────────────────────────────────────────────
// doGet：重導向至 Netlify 手機端 App
// 手機端已改為獨立 Vue PWA，部署於 Netlify。
// 在 Config 分頁設定 key=mobile_url 即可讓此頁自動跳轉。
// ─────────────────────────────────────────────────────────────────────
function doGet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = ss.getSheetByName('Config');
  let mobileUrl = '';
  if (cfg) {
    const row = cfg.getDataRange().getValues().find(r => r[0] === 'mobile_url');
    if (row) mobileUrl = String(row[1]);
  }
  if (mobileUrl) {
    return HtmlService.createHtmlOutput(
      '<script>location.replace(' + JSON.stringify(mobileUrl) + ')<\/script>'
    );
  }
  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;padding:2rem">手機端 App 尚未設定。<br>' +
    '請在 Config 分頁新增 <code>mobile_url</code> 指向 Netlify 部署網址。</p>'
  );
}

// ─────────────────────────────────────────────────────────────────────
// doPost：API 端點
// ─────────────────────────────────────────────────────────────────────
/** 根據 payload 中選擇性的 spreadsheetId 決定目標試算表 */
function getTargetSS(p) {
  return p.spreadsheetId
    ? SpreadsheetApp.openById(p.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
}

/** 在 Config sheet 寫入 {tableName}_last_updated = ISO 時間，供多裝置版本偵測使用 */
function _setLastUpdated(tableName) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
  const vals = cfg.getDataRange().getValues();
  const key  = tableName + '_last_updated';
  const iso  = new Date().toISOString();
  const rowIdx = vals.findIndex(function(r) { return r[0] === key; });
  if (rowIdx >= 0) {
    cfg.getRange(rowIdx + 1, 2).setValue(iso);
  } else {
    cfg.appendRow([key, iso]);
  }
}

/** 取得所有 *_last_updated 版本時間戳，供客戶端輪詢比對 */
function getVersions() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = ss.getSheetByName('Config');
  if (!cfg) return json({ ok: true, data: {} });
  const versions = {};
  cfg.getDataRange().getValues().forEach(function(r) {
    if (r[0] && String(r[0]).endsWith('_last_updated')) {
      const v = r[1];
      versions[String(r[0])] = (v instanceof Date) ? v.toISOString() : String(v);
    }
  });
  return json({ ok: true, data: versions });
}

// ─────────────────────────────────────────────────────────────────────
// 通用逐筆同步（syncTable）
// 每張表：資料 Sheet（最後一欄 updated_at）＋ 共用的 Tombstones Sheet（table, key, deleted_at）。
// 同一 key 以 updated_at 較新者為準；刪除與修改比時間，較晚者勝。
// 新增資料表只需在 SYNC_TABLES 加一筆設定。
// ─────────────────────────────────────────────────────────────────────
const SYNC_TABLES = {
  physicians: {
    sheet: 'Physicians',
    key: 'name',
    fields:  ['name', 'department', 'title', 'ext', 'his_account', 'his_password', 'phs_account', 'phs_password', 'notes'],
    headers: ['姓名', '科別', '職稱', '分機', 'HIS帳號', 'HIS密碼', 'PHS帳號', 'PHS密碼', '備註'],
  },
  // ADR-011：以下各表改為逐筆同步，寫入新的 Sync_* 工作表，舊工作表保留不動
  prescriptions: { sheet: 'Sync_Prescriptions', key: 'uid', fields: ['uid', 'name', 'category', 'indication', 'orders', 'notes'] },
  surgery:       { sheet: 'Sync_Surgery',       key: 'uid', fields: ['uid', 'name', 'category', 'indication', 'pre_op_orders', 'post_op_orders', 'notes'] },
  examination:   { sheet: 'Sync_Examination',   key: 'uid', fields: ['uid', 'name', 'his_code', 'category', 'indication', 'orders', 'notes'] },
  disease:       { sheet: 'Sync_Disease',       key: 'uid', fields: ['uid', 'name', 'icd10', 'category', 'workup', 'treatment_orders', 'consult_flow', 'notes'] },
  shiftMemos:    { sheet: 'Sync_ShiftMemos',    key: 'uid', fields: ['uid', 'category', 'title', 'content', 'sort_order'] },
  contacts:      { sheet: 'Sync_Contacts',      key: 'uid', fields: ['uid', 'label', 'ext', 'category', 'notes'] },
  items:         { sheet: 'Sync_Items',         key: 'hospital_code', fields: ['hospital_code', 'name_en', 'name_zh', 'purpose', 'unit', 'price', 'supplier', 'notes', 'depts'] },
  sets:          { sheet: 'Sync_Sets',          key: 'uid', fields: ['uid', 'name', 'surgery_type', 'physician_name', 'notes', 'items'] },
  surgeryTypes:  { sheet: 'Sync_SurgeryTypes',  key: 'uid', fields: ['uid', 'name', 'dept', 'notes', 'items'] },
  ahk:           { sheet: 'Sync_AhkScripts',    key: 'uid', fields: ['uid', 'name', 'description', 'filename', 'content'] },
};

// 舊版整份上傳／下載的 action。該表建立同步基準後一律拒絕，
// 否則還沒更新的電腦會把雲端整份蓋掉，或拿舊工作表的過期資料蓋掉本地。
const LEGACY_SYNC_ACTIONS = {
  savePrescriptions: 'prescriptions', getPrescriptions: 'prescriptions',
  saveSurgery: 'surgery',             getSurgery: 'surgery',
  saveExamination: 'examination',     getExamination: 'examination',
  saveDisease: 'disease',             getDisease: 'disease',
  saveShiftMemos: 'shiftMemos',       getShiftMemos: 'shiftMemos',
  saveContacts: 'contacts',           getContacts: 'contacts',
  saveItems: 'items',                 getItems: 'items',
  saveSets: 'sets',                   getSets: 'sets',
  saveSurgeryTypes: 'surgeryTypes',   getSurgeryTypes: 'surgeryTypes',
  saveAhkScripts: 'ahk',              getAhkScripts: 'ahk',
};

function _cellStr(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  return v == null ? '' : String(v);
}

function _syncRow(cfg, r, updatedAt) {
  const row = {};
  cfg.fields.forEach(f => { row[f] = r[f] == null ? '' : String(r[f]); });
  row.updated_at = updatedAt == null ? '' : String(updatedAt);
  return row;
}

/** 讀出 { rows: {key: row}, tombs: {key: deleted_at} } */
function _readSyncTable(ss, table) {
  const cfg = SYNC_TABLES[table];
  const tz = ss.getSpreadsheetTimeZone();
  const width = cfg.fields.length + 1;
  const rows = {}, tombs = {};

  const sh = ss.getSheetByName(cfg.sheet);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(r => {
      const row = {};
      cfg.fields.forEach((f, i) => { row[f] = _cellStr(r[i], tz); });
      row.updated_at = _cellStr(r[cfg.fields.length], tz);
      if (row[cfg.key]) rows[row[cfg.key]] = row;
    });
  }

  const shT = ss.getSheetByName('Tombstones');
  if (shT && shT.getLastRow() >= 2) {
    shT.getRange(2, 1, shT.getLastRow() - 1, 3).getValues().forEach(r => {
      if (String(r[0]) === table && r[1] !== '') tombs[_cellStr(r[1], tz)] = _cellStr(r[2], tz);
    });
  }
  return { rows, tombs };
}

function _writeSyncTable(ss, table, rows, tombs) {
  const cfg = SYNC_TABLES[table];
  const hd = (cfg.headers || cfg.fields).concat(['updated_at']);

  const sh = ss.getSheetByName(cfg.sheet) || ss.insertSheet(cfg.sheet);
  const rw = Object.keys(rows).map(k => cfg.fields.map(f => rows[k][f]).concat([rows[k].updated_at]));
  sh.clearContents();
  sh.getRange(1, 1, 1, hd.length).setValues([hd]);
  if (rw.length) {
    // 全部設純文字：防止前導零被吃掉、日期字串被轉型、= 開頭被當公式
    const range = sh.getRange(2, 1, rw.length, hd.length);
    range.setNumberFormat('@');
    range.setValues(rw);
  }

  // Tombstones 為各表共用：保留其他表的列，只替換本表
  const shT = ss.getSheetByName('Tombstones') || ss.insertSheet('Tombstones');
  const tz = ss.getSpreadsheetTimeZone();
  const others = shT.getLastRow() >= 2
    ? shT.getRange(2, 1, shT.getLastRow() - 1, 3).getValues()
        .filter(r => String(r[0]) !== table && r[0] !== '')
        .map(r => [String(r[0]), _cellStr(r[1], tz), _cellStr(r[2], tz)])
    : [];
  const rwT = others.concat(Object.keys(tombs).map(k => [table, k, tombs[k]]));
  shT.clearContents();
  shT.getRange(1, 1, 1, 3).setValues([['table', 'key', 'deleted_at']]);
  if (rwT.length) {
    const rangeT = shT.getRange(2, 1, rwT.length, 3);
    rangeT.setNumberFormat('@');
    rangeT.setValues(rwT);
  }
}

/**
 * 合併本地送來的資料並寫回。呼叫方須持有 LockService 鎖。
 * force = 「覆蓋」：本地全部以 now 為準，雲端有、本地沒有的寫入刪除紀錄。
 */
function _mergeSyncTable(ss, table, p) {
  const cfg = SYNC_TABLES[table];
  const cur = _readSyncTable(ss, table);
  const before = JSON.stringify(cur);
  const rows = cur.rows, tombs = cur.tombs;
  const now = String(p.now || '');
  const incoming = (p.rows || []).filter(r => r && r[cfg.key] != null && String(r[cfg.key]) !== '');

  if (p.force) {
    const keep = {};
    incoming.forEach(r => { keep[String(r[cfg.key])] = true; });
    Object.keys(rows).forEach(k => { if (!keep[k]) tombs[k] = now; });
    incoming.forEach(r => {
      const k = String(r[cfg.key]);
      rows[k] = _syncRow(cfg, r, now);
      delete tombs[k];
    });
  } else {
    (p.tombstones || []).forEach(t => {
      if (!t || t.key == null || t.key === '') return;
      const k = String(t.key), ts = String(t.deleted_at || '');
      if (!tombs[k] || ts > tombs[k]) tombs[k] = ts;
    });
    incoming.forEach(r => {
      const k = String(r[cfg.key]);
      const c = rows[k];
      const ts = r.updated_at == null ? '' : String(r.updated_at);
      if (!c || ts > c.updated_at) rows[k] = _syncRow(cfg, r, ts);
    });
  }

  // 刪除 vs 修改：時間較晚者勝
  Object.keys(tombs).forEach(k => {
    const r = rows[k];
    if (!r) return;
    if (r.updated_at && r.updated_at > tombs[k]) delete tombs[k];
    else delete rows[k];
  });

  if (JSON.stringify({ rows, tombs }) !== before) {
    _writeSyncTable(ss, table, rows, tombs);
    _setLastUpdated(table);
  }
  return { rows, tombs };
}

// ── 同步基準：某台電腦「覆蓋」後才允許一般同步 ──
// 升級前的雲端資料沒有 updated_at，無法判斷新舊；在基準建立前放行一般同步，
// 不是本地修改被舊資料改回去，就是舊資料蓋掉雲端。
function _getConfigValue(key) {
  const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  if (!cfg) return '';
  const row = cfg.getDataRange().getValues().find(r => r[0] === key);
  return row ? String(row[1] || '') : '';
}

function _setConfigValue(key, value) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
  const vals = cfg.getDataRange().getValues();
  const idx  = vals.findIndex(r => r[0] === key);
  if (idx >= 0) cfg.getRange(idx + 1, 2).setValue(value);
  else cfg.appendRow([key, value]);
}

function _withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── NP 值班表（NpDuty 資料 + NpDutyMonths 每月版本）──────────────────
const NP_FIELDS = ['duty_date', 'ward', 'np_name', 'staff_code', 'extension', 'shift', 'notes', 'source_file'];

function _npDutyRow(month, r) {
  const row = { month };
  NP_FIELDS.forEach(f => { row[f] = r[f] == null ? '' : String(r[f]); });
  return row;
}

function _readNpDutyRows(ss) {
  const sh = ss.getSheetByName('NpDuty');
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = ss.getSpreadsheetTimeZone();
  return sh.getRange(2, 1, sh.getLastRow() - 1, NP_FIELDS.length + 1).getValues()
    .filter(r => r[0] !== '')
    .map(r => {
      const row = { month: _cellStr(r[0], tz) };
      NP_FIELDS.forEach((f, i) => { row[f] = _cellStr(r[i + 1], tz); });
      return row;
    });
}

function _writeNpDutyRows(ss, rows) {
  const sh = ss.getSheetByName('NpDuty') || ss.insertSheet('NpDuty');
  const hd = ['month'].concat(NP_FIELDS);
  sh.clearContents();
  sh.getRange(1, 1, 1, hd.length).setValues([hd]);
  if (rows.length) {
    // 純文字：日期不被轉型、分機前導零保留
    const range = sh.getRange(2, 1, rows.length, hd.length);
    range.setNumberFormat('@');
    range.setValues(rows.map(r => hd.map(f => r[f])));
  }
}

function _readNpDutyVersions(ss) {
  const sh = ss.getSheetByName('NpDutyMonths');
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const tz = ss.getSpreadsheetTimeZone();
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const m = _cellStr(r[0], tz);
    if (m) out[m] = _cellStr(r[1], tz);
  });
  return out;
}

function _writeNpDutyVersions(ss, versions) {
  const sh = ss.getSheetByName('NpDutyMonths') || ss.insertSheet('NpDutyMonths');
  const rw = Object.keys(versions).sort().map(m => [m, versions[m]]);
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['month', 'version']]);
  if (rw.length) {
    const range = sh.getRange(2, 1, rw.length, 2);
    range.setNumberFormat('@');
    range.setValues(rw);
  }
}

function doPost(e) {
  const p  = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    const legacyTable = LEGACY_SYNC_ACTIONS[p.action];
    if (legacyTable && _getConfigValue(legacyTable + '_sync_baseline')) {
      return json({ ok: false, code: 'OUTDATED', error: '此資料已改為逐筆同步，請更新 MedBase 至最新版本' });
    }

    switch (p.action) {

      // ── 登入驗證（手機端）────────────────────────────────────────
      case 'login': {
        const staffSheet = ss.getSheetByName('Staff');
        if (!staffSheet) return json({ ok: false, error: 'Staff sheet missing' });
        const rows = staffSheet.getDataRange().getValues().slice(1);
        // 欄位順序：代號[0] 姓名[1] 角色[2] pw_hash[3] 啟用[4] 員工編號[5]
        // 以員工編號（r[5]）比對，相容舊資料（r[5] 為空時 fallback 比對代號 r[0]）
        const user = rows.find(r => {
          const eid = String(r[5] || '');
          const match = eid ? eid === p.code : String(r[0]) === p.code;
          return match && r[3] === p.pwHash && r[4] !== 0;
        });
        if (!user) return json({ ok: false, error: '員工編號或密碼錯誤' });
        return json({ ok: true, data: { code: user[0], name: user[1], role: user[2] } });
      }

      // ── 取得已發布班表（手機端查看） ──────────────────────────────
      case 'getSchedule': {
        // 優先用 p.spreadsheetId；若無則查 Config 的 schedule_spreadsheet_id
        let tss;
        if (p.spreadsheetId) {
          tss = SpreadsheetApp.openById(p.spreadsheetId);
        } else {
          const cfg = ss.getSheetByName('Config');
          let sid = '';
          if (cfg) {
            const row = cfg.getDataRange().getValues().find(r => r[0] === 'schedule_spreadsheet_id');
            if (row) sid = String(row[1] || '');
          }
          tss = sid ? SpreadsheetApp.openById(sid) : ss;
        }
        const sh = tss.getSheetByName(p.sheetName);
        if (!sh) return json({ ok: false, error: '班表分頁不存在' });
        const values = sh.getDataRange().getValues();
        return json({ ok: true, data: values });
      }

      // ── 取得 Config 值 ─────────────────────────────────────────
      case 'getConfig': {
        const cfg = ss.getSheetByName('Config');
        if (!cfg) return json({ ok: true, data: {} });
        const vals = cfg.getDataRange().getValues();
        const result = {};
        vals.forEach(r => {
          if (r[0]) {
            const v = r[1];
            result[String(r[0])] = (v instanceof Date) ? v.toISOString() : String(v);
          }
        });
        return json({ ok: true, data: result });
      }

      // ── 儲存/更新 Config ──────────────────────────────────────────
      case 'saveConfig': {
        let cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
        const vals = cfg.getDataRange().getValues();
        const rowIdx = vals.findIndex(r => r[0] === p.key);
        if (rowIdx >= 0) {
          cfg.getRange(rowIdx + 1, 2).setValue(p.value);
        } else {
          cfg.appendRow([p.key, p.value]);
        }
        return json({ ok: true });
      }

      // ── 儲存員工名單（含 role/pw_hash/employee_id） ──────────────
      case 'saveStaff': {
        let sh = ss.getSheetByName('Staff') || ss.insertSheet('Staff');
        const hd = ['代號', '姓名', '角色', 'pw_hash', '啟用', '員工編號'];
        const rw = p.data.map(r => [r.code, r.name, r.role || 'employee', r.pw_hash || '', 1, r.employee_id || '']);
        sh.clearContents();
        sh.getRange(1, 1, 1, hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2, 1, rw.length, hd.length).setValues(rw);
        return json({ ok: true });
      }

      // ── 儲存班表（batchSaveShifts / saveSchedule） ───────────────
      // 支援 spreadsheetId 參數，可寫入獨立班表試算表
      case 'batchSaveShifts':
      case 'saveSchedule': {
        const tss = getTargetSS(p);
        let sh = tss.getSheetByName(p.sheetName) || tss.insertSheet(p.sheetName);
        const hd = ['姓名', ...Array.from({ length: 31 }, (_, i) => `${i + 1}日`)];
        const rw = p.data.map(r => [r.name, ...r.days.map(d => d || '')]);
        sh.clearContents();
        sh.getRange(1, 1, 1, hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2, 1, rw.length, hd.length).setValues(rw);
        return json({ ok: true });
      }

      // ── 儲存輪序池狀態 ─────────────────────────────────────────
      case 'saveRotation': {
        let sh = ss.getSheetByName('Rotation') || ss.insertSheet('Rotation');
        const hd = ['poolName', 'label', 'shiftCode', 'quota', 'order', 'lastIndex'];
        const rw = (p.pools || []).map(pool => [
          pool.poolName, pool.label, pool.shiftCode, pool.quota,
          JSON.stringify(pool.order), pool.lastIndex
        ]);
        sh.clearContents();
        sh.getRange(1, 1, 1, hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2, 1, rw.length, hd.length).setValues(rw);
        return json({ ok: true });
      }

      // ── 員工提交預約班別請求（手機端） ───────────────────────────
      case 'saveRequest': {
        // Requests_YYYYMM: code, name, submitted_at, d1_v1, d1_v2, d1_v3, ... d31_v3
        const shName = `Requests_${p.yyyyMM}`;
        let sh = ss.getSheetByName(shName) || ss.insertSheet(shName);

        // Build header if empty
        if (sh.getLastRow() === 0) {
          const hd = ['代號', '姓名', '提交時間'];
          for (let d = 1; d <= 31; d++) {
            hd.push(`${d}日_v1`, `${d}日_v2`, `${d}日_v3`);
          }
          sh.getRange(1, 1, 1, hd.length).setValues([hd]);
        }

        // Find existing row for this code, or append
        const vals = sh.getDataRange().getValues();
        const rowIdx = vals.findIndex((r, i) => i > 0 && r[0] === p.code);

        const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const row = [p.code, p.name, now];
        const days = p.days || []; // [{v1,v2,v3}, ...] length 31
        for (let di = 0; di < 31; di++) {
          const d = days[di] || {};
          row.push(d.v1 || '', d.v2 || '', d.v3 || '');
        }

        if (rowIdx >= 0) {
          sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
        } else {
          sh.appendRow(row);
        }
        return json({ ok: true });
      }

      // ── 拉取請求列表（桌面端 + 手機端） ──────────────────────────
      case 'getRequests': {
        const shName = `Requests_${p.yyyyMM}`;
        const sh = ss.getSheetByName(shName);
        if (!sh) return json({ ok: true, data: [] });
        const vals = sh.getDataRange().getValues();
        if (vals.length < 2) return json({ ok: true, data: [] });
        const rows = vals.slice(1).map(row => ({
          code: String(row[0] || ''),
          name: String(row[1] || ''),
          submittedAt: String(row[2] || ''),
          days: Array.from({ length: 31 }, (_, di) => ({
            v1: row[3 + di * 3] ? String(row[3 + di * 3]) : null,
            v2: row[4 + di * 3] ? String(row[4 + di * 3]) : null,
            v3: row[5 + di * 3] ? String(row[5 + di * 3]) : null,
          })),
        })).filter(r => r.code);
        return json({ ok: true, data: rows });
      }

      // ── 儲存常用分機（桌機端推送）────────────────────────────────
      case 'saveContacts': {
        let sh = ss.getSheetByName('Contacts') || ss.insertSheet('Contacts');
        const hd = ['label','ext','category','notes'];
        const rw = (p.data || []).map(r => [r.label||'', r.ext||'', r.category||'', r.notes||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('contacts');
        return json({ ok: true });
      }

      // ── 拉取常用分機（桌機端拉取）────────────────────────────────
      case 'getContacts': {
        const sh = ss.getSheetByName('Contacts');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.map(r => ({
          label:    String(r[0]||''), ext:      String(r[1]||''),
          category: String(r[2]||'常用分機'), notes: String(r[3]||'')
        })).filter(r => r.label && r.ext);
        return json({ ok: true, data });
      }

      // ── 通用逐筆同步（桌機端，新版） ──────────────────────────────
      // p: { table, rows, tombstones, now, force }，回傳合併後的完整結果
      case 'syncTable': {
        const cfg = SYNC_TABLES[p.table];
        if (!cfg) return json({ ok: false, error: `Unknown sync table: ${p.table}` });
        const baselineKey = p.table + '_sync_baseline';
        const merged = _withLock(() => {
          if (!p.force && !_getConfigValue(baselineKey)) return null;
          const m = _mergeSyncTable(ss, p.table, p);
          if (p.force) _setConfigValue(baselineKey, String(p.now || ''));
          return m;
        });
        if (!merged) {
          return json({ ok: false, code: 'NO_BASELINE', error: '尚未建立同步基準：請先在資料最完整的電腦按「覆蓋」' });
        }
        return json({
          ok: true,
          rows: Object.keys(merged.rows).map(k => merged.rows[k]),
          tombstones: Object.keys(merged.tombs).map(k => ({ key: k, deleted_at: merged.tombs[k] })),
        });
      }

      // ── 儲存醫師通訊錄（舊版桌機端） ──────────────────────────────
      // 舊版會送整份本地資料全量覆寫；多台電腦並用時會互相蓋掉，且舊版送不出
      // 刪除與時間戳。升級過渡期間改為「只新增雲端沒有、也未被刪除的人」。
      case 'savePhysicians': {
        const added = _withLock(() => {
          const cur = _readSyncTable(ss, 'physicians');
          let n = 0;
          (p.data || []).forEach(r => {
            if (!r || !r.name || cur.rows[r.name] || cur.tombs[r.name]) return;
            cur.rows[r.name] = _syncRow(SYNC_TABLES.physicians, r, '');
            n++;
          });
          if (n) {
            _writeSyncTable(ss, 'physicians', cur.rows, cur.tombs);
            _setLastUpdated('physicians');
          }
          return n;
        });
        return json({ ok: true, added });
      }

      // ── 拉取醫師通訊錄（舊版桌機端） ──────────────────────────────
      case 'getPhysicians': {
        const rows = _readSyncTable(ss, 'physicians').rows;
        return json({ ok: true, data: Object.keys(rows).map(k => rows[k]) });
      }

      // ── NP 值班表：以「月」為單位同步 ──────────────────────────────
      // 班表是每月一份、重新匯入即整月取代，逐筆合併反而會把改掉的人留下來。
      // NpDutyMonths 記每月版本；上傳時版本較新才取代整月。
      case 'getNpDutyVersions': {
        return json({ ok: true, data: _readNpDutyVersions(ss) });
      }

      case 'getNpDutyMonths': {
        const want = {};
        (p.months || []).forEach(m => { want[String(m)] = true; });
        const versions = _readNpDutyVersions(ss);
        const data = {};
        Object.keys(want).forEach(m => { data[m] = { version: versions[m] || '', rows: [] }; });
        _readNpDutyRows(ss).forEach(r => { if (want[r.month]) data[r.month].rows.push(r); });
        return json({ ok: true, data });
      }

      case 'saveNpDutyMonth': {
        const month = String(p.month || ''), version = String(p.version || '');
        if (!/^\d{4}-\d{2}$/.test(month) || !version) return json({ ok: false, error: 'month / version 格式錯誤' });
        const result = _withLock(() => {
          const versions = _readNpDutyVersions(ss);
          if (versions[month] && versions[month] >= version) return { stale: versions[month] };
          const kept = _readNpDutyRows(ss).filter(r => r.month !== month);
          const added = (p.rows || []).map(r => _npDutyRow(month, r));
          _writeNpDutyRows(ss, kept.concat(added));
          versions[month] = version;
          _writeNpDutyVersions(ss, versions);
          _setLastUpdated('npDuty');
          return { count: added.length };
        });
        if (result.stale) return json({ ok: false, code: 'STALE', version: result.stale, error: '雲端已有較新的版本' });
        return json({ ok: true, count: result.count });
      }

      // ── 儲存自費品項（桌機端推送） ────────────────────────────────
      case 'saveItems': {
        let sh = ss.getSheetByName('Items') || ss.insertSheet('Items');
        const hd = ['hospital_code','name_zh','name_en','purpose','unit','price','supplier','notes','depts'];
        const rw = (p.data || []).map(r => [
          r.hospital_code, r.name_zh||'', r.name_en||'', r.purpose||'',
          r.unit||'', r.price ?? '', r.supplier||'', r.notes||'',
          (r.depts||[]).join(',')
        ]);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('items');
        return json({ ok: true });
      }

      // ── 拉取自費品項（桌機端拉取） ────────────────────────────────
      case 'getItems': {
        const sh = ss.getSheetByName('Items');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          hospital_code: String(r[0]||''), name_zh: String(r[1]||''), name_en: String(r[2]||''),
          purpose: String(r[3]||''), unit: String(r[4]||''), price: r[5] !== '' ? Number(r[5]) : null,
          supplier: String(r[6]||''), notes: String(r[7]||''),
          depts: r[8] ? String(r[8]).split(',').map(d=>d.trim()).filter(Boolean) : []
        }));
        return json({ ok: true, data });
      }

      // ── 儲存套組（桌機端推送） ────────────────────────────────────
      case 'saveSets': {
        // Sets sheet
        let sh1 = ss.getSheetByName('Sets') || ss.insertSheet('Sets');
        const hd1 = ['id','name','surgery_type','physician_id','phys_name','notes'];
        const rw1 = (p.sets||[]).map(r => [r.id, r.name||'', r.surgery_type||'', r.physician_id??'', r.phys_name||'', r.notes||'']);
        sh1.clearContents();
        sh1.getRange(1,1,1,hd1.length).setValues([hd1]);
        if (rw1.length) sh1.getRange(2,1,rw1.length,hd1.length).setValues(rw1);
        // SetItems sheet
        let sh2 = ss.getSheetByName('SetItems') || ss.insertSheet('SetItems');
        const hd2 = ['id','set_id','hospital_code','quantity','is_optional','sort_order','notes'];
        const rw2 = (p.setItems||[]).map(r => [r.id, r.set_id, r.hospital_code||'', r.quantity, r.is_optional, r.sort_order, r.notes||'']);
        sh2.clearContents();
        sh2.getRange(1,1,1,hd2.length).setValues([hd2]);
        if (rw2.length) sh2.getRange(2,1,rw2.length,hd2.length).setValues(rw2);
        // SetPhysicians sheet — referenced physicians with full info
        if (p.physicians && p.physicians.length) {
          let shP = ss.getSheetByName('SetPhysicians') || ss.insertSheet('SetPhysicians');
          const hdP = ['id','name','department','title'];
          const rwP = p.physicians.map(r => [r.id, r.name||'', r.department||'', r.title||'']);
          shP.clearContents();
          shP.getRange(1,1,1,hdP.length).setValues([hdP]);
          shP.getRange(2,1,rwP.length,hdP.length).setValues(rwP);
        }
        _setLastUpdated('sets');
        return json({ ok: true });
      }

      // ── 拉取套組（桌機端拉取） ────────────────────────────────────
      case 'getSets': {
        const sh1 = ss.getSheetByName('Sets');
        const sh2 = ss.getSheetByName('SetItems');
        const shP = ss.getSheetByName('SetPhysicians');
        const sets = sh1 && sh1.getLastRow() >= 2
          ? sh1.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>({
              id: Number(r[0]), name: String(r[1]||''), surgery_type: String(r[2]||''),
              physician_id: r[3]!=='' ? Number(r[3]) : null, phys_name: String(r[4]||''), notes: String(r[5]||'')
            })) : [];
        const setItems = sh2 && sh2.getLastRow() >= 2
          ? sh2.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>({
              id: Number(r[0]), set_id: Number(r[1]), hospital_code: String(r[2]||''),
              quantity: Number(r[3]||1), is_optional: Number(r[4]||0),
              sort_order: Number(r[5]||0), notes: String(r[6]||'')
            })) : [];
        const physicians = shP && shP.getLastRow() >= 2
          ? shP.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>({
              id: Number(r[0]), name: String(r[1]||''), department: String(r[2]||''), title: String(r[3]||'')
            })) : [];
        return json({ ok: true, sets, setItems, physicians });
      }

      // ── 備份藥物字典（桌機端推送） ────────────────────────────────
      case 'saveMedications': {
        let sh = ss.getSheetByName('Medications') || ss.insertSheet('Medications');
        const hd = ['id','name','generic_name','synonyms','category','route','dose','iv_rate','warnings','notes'];
        const rw = (p.data || []).map(r => [
          r.id, r.name||'', r.generic_name||'', r.synonyms||'',
          r.category||'', r.route||'', r.dose||'', r.iv_rate||'',
          r.warnings||'', r.notes||''
        ]);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        return json({ ok: true, count: rw.length });
      }

      // ── 還原藥物字典（桌機端拉取） ────────────────────────────────
      case 'getMedications': {
        const sh = ss.getSheetByName('Medications');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[1]).map(r => ({
          id: Number(r[0]||0), name: String(r[1]||''), generic_name: String(r[2]||''),
          synonyms: String(r[3]||''), category: String(r[4]||''), route: String(r[5]||''),
          dose: String(r[6]||''), iv_rate: String(r[7]||''),
          warnings: String(r[8]||''), notes: String(r[9]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 備份 AHK 腳本（桌機端推送） ──────────────────────────────
      case 'saveAhkScripts': {
        let sh = ss.getSheetByName('AhkScripts') || ss.insertSheet('AhkScripts');
        const hd = ['id','name','file_path','description','content','updated_at'];
        const rw = (p.scripts||[]).map(r => [
          r.id, r.name||'', r.file_path||'', r.description||'', r.content||'', r.updated_at||''
        ]);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) {
          // 設為純文字：否則 updated_at 會被轉成日期、以 = 開頭的內容會被當公式
          sh.getRange(2, 1, rw.length, hd.length).setNumberFormat('@');
          sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        }
        _setLastUpdated('ahk');
        return json({ ok: true });
      }

      // ── 還原 AHK 腳本（桌機端拉取） ──────────────────────────────
      case 'getAhkScripts': {
        const sh = ss.getSheetByName('AhkScripts');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, scripts: [] });
        const scripts = sh.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
          id: Number(r[0]), name: String(r[1]||''), file_path: String(r[2]||''),
          description: String(r[3]||''), content: String(r[4]||''),
          updated_at: r[5] instanceof Date
            ? Utilities.formatDate(r[5], ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss')
            : String(r[5]||'')
        }));
        return json({ ok: true, scripts });
      }

      // ── 取得班別代號列表（手機端） ───────────────────────────────
      case 'getShifts': {
        const sh = ss.getSheetByName('Shifts');
        if (!sh) return json({ ok: true, data: ['D','N','AM','Off'] });
        const vals = sh.getDataRange().getValues().slice(1);
        const codes = vals.map(r => String(r[0])).filter(c => c);
        return json({ ok: true, data: codes.length ? codes : ['D','N','AM','Off'] });
      }

      // ── 儲存班別代號列表（桌機端推送） ──────────────────────────
      case 'saveShifts': {
        let sh = ss.getSheetByName('Shifts') || ss.insertSheet('Shifts');
        sh.clearContents();
        sh.getRange(1, 1).setValue('代號');
        const codes = (p.codes || []).filter(c => c);
        if (codes.length) sh.getRange(2, 1, codes.length, 1).setValues(codes.map(c => [c]));
        return json({ ok: true });
      }

      // ── 儲存處方配製參考（桌機端推送）───────────────────────────
      case 'savePrescriptions': {
        let sh = ss.getSheetByName('Prescriptions') || ss.insertSheet('Prescriptions');
        const hd = ['id','name','category','indication','orders','notes'];
        const rw = (p.data || []).map(r => [r.id, r.name||'', r.category||'', r.indication||'', r.orders||'[]', r.notes||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('prescriptions');
        return json({ ok: true, count: rw.length });
      }

      // ── 拉取處方配製參考（桌機端拉取）───────────────────────────
      case 'getPrescriptions': {
        const sh = ss.getSheetByName('Prescriptions');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          id: Number(r[0]), name: String(r[1]||''), category: String(r[2]||''),
          indication: String(r[3]||''), orders: String(r[4]||'[]'), notes: String(r[5]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 儲存手術術前後常規（桌機端推送）─────────────────────────
      case 'saveSurgery': {
        let sh = ss.getSheetByName('Surgery') || ss.insertSheet('Surgery');
        const hd = ['id','name','category','indication','pre_op_orders','post_op_orders','notes'];
        const rw = (p.data || []).map(r => [r.id, r.name||'', r.category||'', r.indication||'', r.pre_op_orders||'[]', r.post_op_orders||'[]', r.notes||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('surgery');
        return json({ ok: true, count: rw.length });
      }

      // ── 拉取手術術前後常規（桌機端拉取）─────────────────────────
      case 'getSurgery': {
        const sh = ss.getSheetByName('Surgery');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          id: Number(r[0]), name: String(r[1]||''), category: String(r[2]||''),
          indication: String(r[3]||''), pre_op_orders: String(r[4]||'[]'),
          post_op_orders: String(r[5]||'[]'), notes: String(r[6]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 儲存檢查處置備忘（桌機端推送）───────────────────────────
      case 'saveExamination': {
        let sh = ss.getSheetByName('Examination') || ss.insertSheet('Examination');
        const hd = ['id','name','his_code','category','indication','orders','notes'];
        const rw = (p.data || []).map(r => [r.id, r.name||'', r.his_code||'', r.category||'', r.indication||'', r.orders||'[]', r.notes||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('examination');
        return json({ ok: true, count: rw.length });
      }

      // ── 拉取檢查處置備忘（桌機端拉取）───────────────────────────
      case 'getExamination': {
        const sh = ss.getSheetByName('Examination');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          id: Number(r[0]), name: String(r[1]||''), his_code: String(r[2]||''),
          category: String(r[3]||''), indication: String(r[4]||''),
          orders: String(r[5]||'[]'), notes: String(r[6]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 儲存疾病常規（桌機端推送）────────────────────────────────
      case 'saveDisease': {
        let sh = ss.getSheetByName('Disease') || ss.insertSheet('Disease');
        const hd = ['id','name','icd10','category','workup','treatment_orders','consult_flow','notes'];
        const rw = (p.data || []).map(r => [r.id, r.name||'', r.icd10||'', r.category||'', r.workup||'[]', r.treatment_orders||'[]', r.consult_flow||'', r.notes||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('disease');
        return json({ ok: true, count: rw.length });
      }

      // ── 拉取疾病常規（桌機端拉取）────────────────────────────────
      case 'getDisease': {
        const sh = ss.getSheetByName('Disease');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          id: Number(r[0]), name: String(r[1]||''), icd10: String(r[2]||''),
          category: String(r[3]||''), workup: String(r[4]||'[]'),
          treatment_orders: String(r[5]||'[]'), consult_flow: String(r[6]||''), notes: String(r[7]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 儲存 ICD 代碼（桌機端推送）──────────────────────────────
      case 'saveIcdCodes': {
        let sh = ss.getSheetByName('IcdCodes') || ss.insertSheet('IcdCodes');
        const hd = ['code','version','description_zh','description_en','category'];
        const rw = (p.data || []).map(r => [r.code||'', r.version||'ICD10', r.description_zh||'', r.description_en||'', r.category||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        return json({ ok: true, count: rw.length });
      }

      // ── 拉取 ICD 代碼（桌機端拉取）──────────────────────────────
      case 'getIcdCodes': {
        const sh = ss.getSheetByName('IcdCodes');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          code: String(r[0]||''), version: String(r[1]||'ICD10'),
          description_zh: String(r[2]||''), description_en: String(r[3]||''),
          category: String(r[4]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 儲存規則備忘錄（桌機端推送）─────────────────────────────
      case 'saveShiftMemos': {
        let sh = ss.getSheetByName('ShiftMemos') || ss.insertSheet('ShiftMemos');
        const hd = ['id','category','title','content','sort_order','updated_at'];
        const rw = (p.data || []).map(r => [r.id, r.category||'', r.title||'', r.content||'', r.sort_order||0, r.updated_at||'']);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        _setLastUpdated('shiftMemos');
        return json({ ok: true, count: rw.length });
      }

      // ── 拉取規則備忘錄（桌機端拉取）─────────────────────────────
      case 'getShiftMemos': {
        const sh = ss.getSheetByName('ShiftMemos');
        if (!sh || sh.getLastRow() < 2) return json({ ok: true, data: [] });
        const rows = sh.getDataRange().getValues().slice(1);
        const data = rows.filter(r => r[0]).map(r => ({
          id: Number(r[0]), category: String(r[1]||''), title: String(r[2]||''),
          content: String(r[3]||''), sort_order: Number(r[4]||0), updated_at: String(r[5]||'')
        }));
        return json({ ok: true, data });
      }

      // ── 儲存手術術式（桌機端推送）─────────────────────────────────
      case 'saveSurgeryTypes': {
        // SurgeryTypes sheet
        let sh1 = ss.getSheetByName('SurgeryTypes') || ss.insertSheet('SurgeryTypes');
        const hd1 = ['id','name','dept','notes'];
        const rw1 = (p.surgeryTypes||[]).map(r => [r.id, r.name||'', r.dept||'', r.notes||'']);
        sh1.clearContents();
        sh1.getRange(1,1,1,hd1.length).setValues([hd1]);
        if (rw1.length) sh1.getRange(2,1,rw1.length,hd1.length).setValues(rw1);
        // SurgeryTypeItems sheet
        let sh2 = ss.getSheetByName('SurgeryTypeItems') || ss.insertSheet('SurgeryTypeItems');
        const hd2 = ['surgery_type_id','hospital_code'];
        const rw2 = (p.surgeryTypeItems||[]).map(r => [r.surgery_type_id, r.hospital_code||'']);
        sh2.clearContents();
        sh2.getRange(1,1,1,hd2.length).setValues([hd2]);
        if (rw2.length) sh2.getRange(2,1,rw2.length,hd2.length).setValues(rw2);
        return json({ ok: true, count: rw1.length });
      }

      // ── 拉取手術術式（桌機端拉取）─────────────────────────────────
      case 'getSurgeryTypes': {
        const sh1 = ss.getSheetByName('SurgeryTypes');
        const sh2 = ss.getSheetByName('SurgeryTypeItems');
        const surgeryTypes = sh1 && sh1.getLastRow() >= 2
          ? sh1.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>({
              id: Number(r[0]), name: String(r[1]||''), dept: String(r[2]||''), notes: String(r[3]||'')
            })) : [];
        const surgeryTypeItems = sh2 && sh2.getLastRow() >= 2
          ? sh2.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>({
              surgery_type_id: Number(r[0]), hospital_code: String(r[1]||'')
            })) : [];
        return json({ ok: true, surgeryTypes, surgeryTypeItems });
      }

      // ── 取得版本時間戳（多裝置同步輪詢用）────────────────────────
      case 'getVersions': return getVersions();

      default:
        return json({ ok: false, error: `Unknown action: ${p.action}` });
    }
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────
// handleApi：供 google.script.run 呼叫（繞過 CORS）
// ─────────────────────────────────────────────────────────────────────
function handleApi(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    switch (p.action) {
      case 'login': {
        const staffSheet = ss.getSheetByName('Staff');
        if (!staffSheet) return { ok: false, error: 'Staff sheet missing' };
        const rows = staffSheet.getDataRange().getValues().slice(1);
        // 欄位順序：代號[0] 姓名[1] 角色[2] pw_hash[3] 啟用[4] 員工編號[5]
        const user = rows.find(r => {
          const eid = String(r[5] || '');
          const match = eid ? eid === String(p.code) : String(r[0]) === String(p.code);
          return match && String(r[3]) === String(p.pwHash) && r[4] != 0;
        });
        if (!user) return { ok: false, error: '員工編號或密碼錯誤' };
        return { ok: true, data: { code: String(user[0]), name: String(user[1]), role: String(user[2]) } };
      }
      case 'getSchedule': {
        let tss = ss;
        const cfg = ss.getSheetByName('Config');
        if (cfg) {
          const row = cfg.getDataRange().getValues().find(r => r[0] === 'schedule_spreadsheet_id');
          if (row && row[1]) tss = SpreadsheetApp.openById(String(row[1]));
        }
        const sh = tss.getSheetByName(p.sheetName);
        if (!sh) return { ok: false, error: '班表分頁不存在' };
        return { ok: true, data: sh.getDataRange().getValues() };
      }
      case 'getConfig': {
        const cfg = ss.getSheetByName('Config');
        if (!cfg) return { ok: true, data: {} };
        const result = {};
        cfg.getDataRange().getValues().forEach(r => { if (r[0]) result[String(r[0])] = String(r[1]); });
        return { ok: true, data: result };
      }
      case 'saveRequest': {
        const shName = 'Requests_' + p.yyyyMM;
        let sh = ss.getSheetByName(shName) || ss.insertSheet(shName);
        if (sh.getLastRow() === 0) {
          const hd = ['代號', '姓名', '提交時間'];
          for (let d = 1; d <= 31; d++) hd.push(d+'日_v1', d+'日_v2', d+'日_v3');
          sh.getRange(1, 1, 1, hd.length).setValues([hd]);
        }
        const vals = sh.getDataRange().getValues();
        const rowIdx = vals.findIndex((r, i) => i > 0 && String(r[0]) === String(p.code));
        const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const row = [p.code, p.name, now];
        const days = p.days || [];
        for (let di = 0; di < 31; di++) {
          const d = days[di] || {};
          row.push(d.v1 || '', d.v2 || '', d.v3 || '');
        }
        if (rowIdx >= 0) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
        else sh.appendRow(row);
        return { ok: true };
      }
      case 'getShifts': {
        const sh = ss.getSheetByName('Shifts');
        if (!sh) return { ok: true, data: ['D','N','AM','Off'] };
        const vals = sh.getDataRange().getValues().slice(1);
        const codes = vals.map(r => String(r[0])).filter(c => c);
        return { ok: true, data: codes.length ? codes : ['D','N','AM','Off'] };
      }
      default:
        return { ok: false, error: 'Unknown action: ' + p.action };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
