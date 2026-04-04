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
function doPost(e) {
  const p  = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    switch (p.action) {

      // ── 登入驗證（手機端） ────────────────────────────────────────
      case 'login': {
        const staffSheet = ss.getSheetByName('Staff');
        if (!staffSheet) return json({ ok: false, error: 'Staff sheet missing' });
        const rows = staffSheet.getDataRange().getValues().slice(1);
        const user = rows.find(r => r[0] === p.code && r[3] === p.pwHash && r[4] !== 0);
        if (!user) return json({ ok: false, error: '代號或密碼錯誤' });
        return json({ ok: true, data: { code: user[0], name: user[1], role: user[2] } });
      }

      // ── 取得已發布班表（手機端查看） ──────────────────────────────
      case 'getSchedule': {
        const sh = ss.getSheetByName(p.sheetName);
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
        vals.forEach(r => { if (r[0]) result[r[0]] = r[1]; });
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

      // ── 儲存員工名單（含 role/pw_hash） ─────────────────────────
      case 'saveStaff': {
        let sh = ss.getSheetByName('Staff') || ss.insertSheet('Staff');
        const hd = ['代號', '姓名', '角色', 'pw_hash', '啟用'];
        const rw = p.data.map(r => [r.code, r.name, r.role || 'employee', r.pw_hash || '', 1]);
        sh.clearContents();
        sh.getRange(1, 1, 1, hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2, 1, rw.length, hd.length).setValues(rw);
        return json({ ok: true });
      }

      // ── 儲存班表（batchSaveShifts / saveSchedule） ───────────────
      case 'batchSaveShifts':
      case 'saveSchedule': {
        let sh = ss.getSheetByName(p.sheetName) || ss.insertSheet(p.sheetName);
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

      // ── 拉取請求列表（桌面端） ─────────────────────────────────
      case 'getRequests': {
        const shName = `Requests_${p.yyyyMM}`;
        const sh = ss.getSheetByName(shName);
        if (!sh) return json({ ok: true, data: [] });
        return json({ ok: true, data: sh.getDataRange().getValues() });
      }

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
        const user = rows.find(r => String(r[0]) === String(p.code) && String(r[3]) === String(p.pwHash) && r[4] != 0);
        if (!user) return { ok: false, error: '代號或密碼錯誤' };
        return { ok: true, data: { code: String(user[0]), name: String(user[1]), role: String(user[2]) } };
      }
      case 'getSchedule': {
        const sh = ss.getSheetByName(p.sheetName);
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
