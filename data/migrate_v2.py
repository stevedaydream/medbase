"""
MedBase DB Migration v2
- physicians.is_vs          新增（標記套組 VS）
- sets.physician_id         新增 FK → physicians
- sets.doctor_id            移除
- set_items.name_en/name_zh 移除冗餘
- set_items.sort_order      新增
- set_items.is_optional     新增（quantity IS NULL → is_optional=1）
- doctors 表                廢棄（資料已遷移）
"""
import sqlite3, re

DB = r'C:\Users\User\AppData\Roaming\com.medbase.app\medbase.db'
conn = sqlite3.connect(DB)
conn.execute("PRAGMA foreign_keys = OFF")   # 遷移期間暫停 FK 檢查

# ─────────────────────────────────────────────
# 1. physicians 加 is_vs 欄位
# ─────────────────────────────────────────────
existing = {r[1] for r in conn.execute("PRAGMA table_info(physicians)")}
if 'is_vs' not in existing:
    conn.execute("ALTER TABLE physicians ADD COLUMN is_vs INTEGER DEFAULT 0")
    print("[1] physicians.is_vs 加入")
else:
    print("[1] physicians.is_vs 已存在，略過")

# ─────────────────────────────────────────────
# 2. sets 加 physician_id 欄位
# ─────────────────────────────────────────────
sets_cols = {r[1] for r in conn.execute("PRAGMA table_info(sets)")}
if 'physician_id' not in sets_cols:
    conn.execute("ALTER TABLE sets ADD COLUMN physician_id INTEGER REFERENCES physicians(id)")
    print("[2] sets.physician_id 加入")
else:
    print("[2] sets.physician_id 已存在，略過")

# ─────────────────────────────────────────────
# 3. doctor → physician 名字對應
# ─────────────────────────────────────────────
doctors = conn.execute("SELECT id, name FROM doctors").fetchall()
phys_by_name = {r[0]: r[1] for r in conn.execute("SELECT name, id FROM physicians")}

doctor_to_phys = {}   # doctor.id → physician.id or None
clean_names    = {}   # doctor.id → 乾淨的醫師名稱

for doc_id, doc_name in doctors:
    raw = doc_name.strip()

    # 嘗試直接匹配
    if raw in phys_by_name:
        doctor_to_phys[doc_id] = phys_by_name[raw]
        clean_names[doc_id] = raw
        continue

    # 從混入備註的名稱中提取（e.g. '蔡明霖乳房自費(兩種都要術後衣)'）
    m = re.match(r'^([\u4e00-\u9fff]{2,4})', raw)
    if m:
        cand = m.group(1)
        if cand in phys_by_name:
            doctor_to_phys[doc_id] = phys_by_name[cand]
            clean_names[doc_id] = cand
            continue

    # 無法對應 → physician_id = NULL
    doctor_to_phys[doc_id] = None
    clean_names[doc_id] = None
    print(f"  [!] doctor.id={doc_id} 無法對應 physicians: {raw!r}")

print(f"[3] doctor→physician 對應完成：{sum(1 for v in doctor_to_phys.values() if v)} / {len(doctors)} 成功")

# ─────────────────────────────────────────────
# 4. 更新 sets.physician_id + 清理 set name/notes
# ─────────────────────────────────────────────
sets_all = conn.execute("SELECT id, name, surgery_type, doctor_id, notes FROM sets").fetchall()
for set_id, name, stype, doc_id, notes in sets_all:
    phys_id = doctor_to_phys.get(doc_id)
    new_name = name
    new_notes = notes
    new_stype = stype

    # Set 14：內視鏡雷射 → 無特定醫師，術式從 name 取
    if doc_id == 7:
        new_name  = name if stype else re.sub(r'\s*[-–]\s*\S+$', '', name).strip()
        new_stype = new_stype or name
        new_notes = "原 Excel VS 欄為手術類型，非特定醫師"

    # Set 15：多人備註 → 清理 name，備註保留原始資訊
    if doc_id == 8:
        new_name  = "多位醫師 - RIRS"
        new_stype = "RIRS"
        new_notes = (notes or '') + ('\n' if notes else '') + name.replace('\r\n', '；')

    # Set 17/18：蔡明霖（附備註）→ name 清理成「蔡明霖 - 術式」
    if doc_id == 10 and clean_names.get(doc_id) == '蔡明霖':
        suffix   = f" - {stype}" if stype else ""
        new_name = f"蔡明霖{suffix}"
        new_notes = "乳房自費（兩種都要術後衣）"

    conn.execute(
        "UPDATE sets SET physician_id=?, name=?, surgery_type=?, notes=? WHERE id=?",
        [phys_id, new_name, new_stype, new_notes, set_id])

# 標記 is_vs
phys_ids = set(v for v in doctor_to_phys.values() if v)
for pid in phys_ids:
    conn.execute("UPDATE physicians SET is_vs=1 WHERE id=?", [pid])

print(f"[4] sets.physician_id 更新完成，{len(phys_ids)} 位醫師標記 is_vs=1")

# ─────────────────────────────────────────────
# 5. 重建 set_items（移除 name_en/name_zh，加 sort_order/is_optional）
# ─────────────────────────────────────────────
conn.execute("""
CREATE TABLE IF NOT EXISTS set_items_v2 (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id       INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    hospital_code TEXT,
    quantity     INTEGER DEFAULT 1,
    is_optional  INTEGER DEFAULT 0,
    sort_order   INTEGER DEFAULT 0,
    price        INTEGER,
    notes        TEXT
)""")
# 清空再插入（冪等）
conn.execute("DELETE FROM set_items_v2")
conn.execute("""
INSERT INTO set_items_v2 (id, set_id, hospital_code, quantity, is_optional, sort_order, price, notes)
SELECT
    id, set_id, hospital_code,
    CASE WHEN quantity IS NULL THEN 1 ELSE quantity END,
    CASE WHEN quantity IS NULL THEN 1 ELSE 0 END,
    id,   -- 用原 id 當初始排序
    price, notes
FROM set_items
""")
conn.execute("DROP TABLE IF EXISTS set_items")
conn.execute("ALTER TABLE set_items_v2 RENAME TO set_items")
print("[5] set_items 重建完成（移除 name_en/name_zh，加 sort_order/is_optional）")

# ─────────────────────────────────────────────
# 6. 重建 sets（移除 doctor_id）
# ─────────────────────────────────────────────
conn.execute("""
CREATE TABLE IF NOT EXISTS sets_v2 (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    surgery_type  TEXT,
    physician_id  INTEGER REFERENCES physicians(id),
    department_id INTEGER REFERENCES departments(id),
    notes         TEXT
)""")
conn.execute("DELETE FROM sets_v2")
conn.execute("""
INSERT INTO sets_v2 (id, name, surgery_type, physician_id, department_id, notes)
SELECT id, name, surgery_type, physician_id, department_id, notes FROM sets
""")
conn.execute("DROP TABLE IF EXISTS sets")
conn.execute("ALTER TABLE sets_v2 RENAME TO sets")
print("[6] sets 重建完成（移除 doctor_id）")

# ─────────────────────────────────────────────
# 7. 重建索引
# ─────────────────────────────────────────────
conn.execute("CREATE INDEX IF NOT EXISTS idx_sets_physician  ON sets(physician_id)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_sets_dept       ON sets(department_id)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_sets_surgery    ON sets(surgery_type)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_set_items_set   ON set_items(set_id)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_set_items_code  ON set_items(hospital_code)")
print("[7] 索引重建完成")

# ─────────────────────────────────────────────
# 8. 廢棄 doctors 表
# ─────────────────────────────────────────────
conn.execute("DROP TABLE IF EXISTS doctors")
conn.execute("DROP TABLE IF EXISTS departments")  # 也清空，physicians.department 是文字，不用這張表
print("[8] doctors / departments 表已廢棄")

# ─────────────────────────────────────────────
# 9. 驗證
# ─────────────────────────────────────────────
print("\n=== 驗證 ===")
for table in ['physicians','sets','set_items','items']:
    c = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    print(f"  {table}: {c} rows")

sets_with_phys = conn.execute("SELECT COUNT(*) FROM sets WHERE physician_id IS NOT NULL").fetchone()[0]
sets_total     = conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
print(f"  sets with physician_id: {sets_with_phys} / {sets_total}")
vs_count       = conn.execute("SELECT COUNT(*) FROM physicians WHERE is_vs=1").fetchone()[0]
print(f"  physicians is_vs=1: {vs_count}")

conn.commit()
conn.execute("PRAGMA foreign_keys = ON")
conn.close()
print("\n[OK] Migration v2 完成")
