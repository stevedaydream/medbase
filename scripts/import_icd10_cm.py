"""
匯入 ICD-10-CM 診斷碼至本地 SQLite
來源：ICD10_CM.mdb → ICD10_desc（主表）+ ICD10_CM_Desc（科別補充）
執行：python scripts/import_icd10_cm.py
"""
import sys, sqlite3, pyodbc, unicodedata
sys.stdout.reconfigure(encoding='utf-8')

def nkfc(s: str) -> str:
    """將 CJK 相容表意文字（如 U+F9BD）統一為標準 code point"""
    return unicodedata.normalize('NFKC', s) if s else s

MDB_PATH = (
    r'c:/Users/User/Downloads/2023年版_ICD-10-CM(113.08.15更新)/'
    r'5.1.2 2023年版_ICD-10-CM(113.04.22更新)/ICD10_CM.mdb'
)
SQLITE_PATH = r'c:/Users/User/AppData/Roaming/com.medbase.app/medbase.db'

print('連線 Access MDB...')
mdb = pyodbc.connect(
    f'DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={MDB_PATH};'
)
cur = mdb.cursor()

# ── 讀取科別對照（code → dept）────────────────────────────────
print('讀取科別資料...')
dept_map = {}
cur.execute('SELECT code, dept FROM ICD10_CM_Desc WHERE dept IS NOT NULL')
for row in cur.fetchall():
    code = str(row[0]).strip()
    dept = str(row[1]).strip()
    if code and dept and code not in dept_map:
        dept_map[code] = dept

cur.execute('SELECT code, dept FROM ICD10_CM_Desc_2 WHERE dept IS NOT NULL')
for row in cur.fetchall():
    code = str(row[0]).strip()
    dept = str(row[1]).strip()
    if code and dept and code not in dept_map:
        dept_map[code] = dept

print(f'  科別對照 {len(dept_map)} 筆')

# ── 讀取主資料（ICD10_desc）──────────────────────────────────
print('讀取 ICD-10-CM 主資料...')
cur.execute('SELECT code, engdesc FROM ICD10_desc')
rows = cur.fetchall()
mdb.close()
print(f'  共 {len(rows)} 筆')

# ── 解析中英文（engdesc 以 \r\n 分隔）───────────────────────
records = []
skipped = 0
for row in rows:
    code = str(row[0]).strip() if row[0] else ''
    desc = str(row[1]) if row[1] else ''
    if not code:
        skipped += 1
        continue
    parts = desc.split('\r\n', 1)
    en = nkfc(parts[0].strip() if len(parts) > 0 else '')
    zh = nkfc(parts[1].strip() if len(parts) > 1 else '')
    category = dept_map.get(code, '')
    records.append((code, 'ICD10', zh, en, category))

print(f'  有效 {len(records)} 筆，跳過 {skipped} 筆')

# ── 寫入 SQLite ───────────────────────────────────────────────
print('連線 SQLite...')
db = sqlite3.connect(SQLITE_PATH)
dbc = db.cursor()

# 清空舊 ICD10 資料
dbc.execute("DELETE FROM icd_codes WHERE version = 'ICD10'")
deleted = dbc.rowcount
print(f'  清除舊 ICD10 資料 {deleted} 筆')

# 批次寫入
dbc.executemany(
    'INSERT OR REPLACE INTO icd_codes (code, version, description_zh, description_en, category) VALUES (?,?,?,?,?)',
    records
)
db.commit()
db.close()

print(f'\n完成！寫入 {len(records)} 筆 ICD-10-CM 診斷碼')
print('範例：')
for r in records[:5]:
    print(f'  {r[0]}  ZH={r[2][:20]}  EN={r[3][:30]}  cat={r[4]}')
