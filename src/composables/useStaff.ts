import { ref, computed, type Ref, type ComputedRef } from "vue";
import { getDb } from "@/db";
import { sha256 } from "@/utils/sha256";
import { toRaw } from "vue";

export interface StaffMember {
  code: string;
  name: string;
  role?: string;
  is_active?: number;
  employee_id?: string;
}

interface ScheduleRow { name: string; days: (string | null)[] }
interface Settings { spreadsheetId: string; apiKey: string; gasUrl: string }

export function useStaff(deps: {
  settings:     Ref<Settings>;
  setSetting:   (key: string, value: string) => Promise<void>;
  showToast:    (msg: string) => void;
  scheduleData: Ref<ScheduleRow[]>;
  yyyyMM:       ComputedRef<string>;
}) {
  const { settings, setSetting, showToast, scheduleData } = deps;

  const staff               = ref<StaffMember[]>([]);
  const newStaffCode        = ref("");
  const newStaffName        = ref("");
  const newStaffEmployeeId  = ref("");
  const staffFilter         = ref("");
  const isStaffLoading      = ref(false);
  const resetPwTarget  = ref<string | null>(null);
  const resetPwInput   = ref("");

  const filteredStaff = computed(() =>
    staffFilter.value
      ? staff.value.filter(s =>
          s.name.includes(staffFilter.value) ||
          s.code.toLowerCase().includes(staffFilter.value.toLowerCase()) ||
          (s.employee_id ?? "").toLowerCase().includes(staffFilter.value.toLowerCase()))
      : staff.value
  );

  async function saveStaffLocal() {
    await setSetting("staff", JSON.stringify(staff.value));
  }

  async function onEmployeeIdChange(member: StaffMember) {
    await saveStaffLocal();
    if (!member.employee_id?.trim()) return;
    try {
      const db = await getDb();
      await db.execute(
        `UPDATE scheduler_users SET employee_id = ? WHERE code = ?`,
        [member.employee_id.trim(), member.code]
      );
    } catch (e) {
      showToast(`員工編號同步失敗：${(e as Error).message}`);
    }
  }

  let _editingOldName = "";
  function onStaffNameFocus(member: StaffMember) { _editingOldName = member.name; }
  function onStaffNameBlur(member: StaffMember) {
    if (_editingOldName && _editingOldName !== member.name) {
      scheduleData.value.forEach(row => {
        if (row.name === _editingOldName) row.name = member.name;
      });
    }
    saveStaffLocal();
    _editingOldName = "";
  }

  function addStaff() {
    const code        = newStaffCode.value.trim();
    const name        = newStaffName.value.trim();
    const employee_id = newStaffEmployeeId.value.trim() || undefined;
    if (!code || !name) return;
    if (staff.value.some(s => s.code === code)) { showToast("代號重複"); return; }
    if (employee_id && staff.value.some(s => s.employee_id === employee_id)) {
      showToast("員工編號重複"); return;
    }
    staff.value.push({ code, name, role: "employee", is_active: 1, employee_id });
    newStaffCode.value       = "";
    newStaffName.value       = "";
    newStaffEmployeeId.value = "";
    saveStaffLocal();
  }

  function removeStaff(idx: number) {
    if (!confirm(`確定移除「${staff.value[idx].name}」？`)) return;
    staff.value.splice(idx, 1);
    saveStaffLocal();
  }

  function importStaffFromSchedule() {
    const existingNames = new Set(staff.value.map(s => s.name));
    let added = 0;
    scheduleData.value.forEach(row => {
      if (!existingNames.has(row.name)) {
        const base = row.name.replace(/\s+/g, "").slice(0, 6) || "user";
        let code = base, i = 1;
        while (staff.value.some(s => s.code === code)) code = base + i++;
        staff.value.push({ code, name: row.name });
        added++;
      }
    });
    if (added) saveStaffLocal();
    showToast(added ? `已匯入 ${added} 位人員` : "無新人員");
  }

  async function pullStaffFromCloud() {
    if (!settings.value.spreadsheetId || !settings.value.apiKey) {
      showToast("請先設定 Spreadsheet ID 與 API Key"); return;
    }
    isStaffLoading.value = true;
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${settings.value.spreadsheetId}/values/Staff?key=${settings.value.apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows: string[][] = (json.values ?? []).slice(1);
      staff.value = rows
        .filter(r => r[0]?.trim() && r[1]?.trim())
        .map(r => ({
          code: r[0].trim(), name: r[1].trim(),
          role: r[2]?.trim() || "employee", is_active: 1,
          employee_id: r[3]?.trim() || undefined,
        }));
      await saveStaffLocal();
      showToast(`已載入 ${staff.value.length} 位人員`);
    } catch (e) {
      showToast(`載入失敗：${(e as Error).message}`);
    } finally { isStaffLoading.value = false; }
  }

  async function pushStaffToCloud() {
    if (!settings.value.gasUrl) { showToast("請先設定 GAS Web App URL"); return; }
    if (!staff.value.length) { showToast("人員名單為空"); return; }
    isStaffLoading.value = true;
    try {
      const db      = await getDb();
      const userRows = await db.select<{ code: string; pw_hash: string }[]>(
        "SELECT code, pw_hash FROM scheduler_users"
      );
      const pwMap = new Map(userRows.map(r => [r.code, r.pw_hash]));
      await fetch(settings.value.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "saveStaff",
          data: toRaw(staff.value).map(s => ({
            code: s.code, name: s.name,
            role: s.role ?? "employee",
            pw_hash: pwMap.get(s.code) ?? "",
            employee_id: s.employee_id ?? "",
          })),
        }),
        mode: "no-cors",
      });
      showToast("人員名單已上傳");
    } catch (e) {
      showToast(`上傳失敗：${(e as Error).message}`);
    } finally { isStaffLoading.value = false; }
  }

  async function resetUserPassword() {
    const code = resetPwTarget.value;
    const pw   = resetPwInput.value.trim();
    if (!code || !pw) return;
    const member = staff.value.find(s => s.code === code);
    if (!member) return;
    try {
      const hash = await sha256(pw);
      const db   = await getDb();
      await db.execute(
        `INSERT INTO scheduler_users (code, name, role, pw_hash, is_active, sort_order, employee_id)
         VALUES (?, ?, ?, ?, 1, 0, ?)
         ON CONFLICT(code) DO UPDATE SET pw_hash = excluded.pw_hash,
           name = excluded.name, role = excluded.role,
           employee_id = excluded.employee_id`,
        [code, member.name, member.role ?? "employee", hash, member.employee_id ?? code]
      );
      showToast(`${member.name} 密碼已重設`);
    } catch (e) {
      showToast(`重設失敗：${(e as Error).message}`);
    }
    resetPwTarget.value = null;
    resetPwInput.value  = "";
  }

  function addRowFromStaff(member: StaffMember) {
    if (scheduleData.value.some(r => r.name === member.name)) {
      showToast(`${member.name} 已在班表中`); return;
    }
    scheduleData.value.push({ name: member.name, days: Array(31).fill(null) });
  }

  function initScheduleFromStaff() {
    if (!staff.value.length) { showToast("人員名單為空"); return; }
    const existing = new Set(scheduleData.value.map(r => r.name));
    let added = 0;
    staff.value.forEach(s => {
      if (!existing.has(s.name)) {
        scheduleData.value.push({ name: s.name, days: Array(31).fill(null) });
        added++;
      }
    });
    showToast(added ? `已加入 ${added} 位人員` : "全員已在班表中");
  }

  return {
    staff, newStaffCode, newStaffName, newStaffEmployeeId, staffFilter, isStaffLoading,
    resetPwTarget, resetPwInput, filteredStaff,
    saveStaffLocal, addStaff, removeStaff, importStaffFromSchedule,
    pullStaffFromCloud, pushStaffToCloud, resetUserPassword,
    addRowFromStaff, initScheduleFromStaff,
    onStaffNameFocus, onStaffNameBlur, onEmployeeIdChange,
  };
}
