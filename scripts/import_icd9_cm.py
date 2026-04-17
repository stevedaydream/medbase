"""
匯入 ICD-9-CM 診斷碼至本地 SQLite
來源：4.1 ICD-9-CM2001年版與ICD-10-CM對應資料檔.xlsx → final 分頁
執行：python scripts/import_icd9_cm.py
"""
import sys, sqlite3, unicodedata
import openpyxl
sys.stdout.reconfigure(encoding='utf-8')

def nkfc(s: str) -> str:
    return unicodedata.normalize('NFKC', s) if s else s

XLSX_PATH = (
    r'c:/Users/User/Downloads/'
    r'4.1 ICD-9-CM2001年版與ICD-10-CM對應資料檔(109.05.01更新).xlsx'
)
SQLITE_PATH = r'c:/Users/User/AppData/Roaming/com.medbase.app/medbase.db'

print('讀取 Excel...')
wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
sh = wb['final']

# 每個 ICD-9 代碼只取第一筆（去重）
seen = set()
records = []
skipped = 0

for row in sh.iter_rows(min_row=2, values_only=True):
    code = str(row[0]).strip() if row[0] else ''
    en   = nkfc(str(row[1]).strip() if row[1] else '')
    zh   = nkfc(str(row[2]).strip() if row[2] else '')
    if not code:
        skipped += 1
        continue
    if code in seen:
        continue
    seen.add(code)
    records.append((code, 'ICD9', zh, en, ''))

print(f'  唯一 ICD-9 代碼 {len(records)} 筆，跳過重複/空白 {skipped} 筆')

print('寫入 SQLite...')
db = sqlite3.connect(SQLITE_PATH)
dbc = db.cursor()

dbc.execute("DELETE FROM icd_codes WHERE version = 'ICD9'")
deleted = dbc.rowcount
print(f'  清除舊 ICD9 資料 {deleted} 筆')

dbc.executemany(
    'INSERT OR REPLACE INTO icd_codes (code, version, description_zh, description_en, category) VALUES (?,?,?,?,?)',
    records
)
db.commit()
db.close()

print(f'\n完成！寫入 {len(records)} 筆 ICD-9-CM 診斷碼')
print('範例：')
for r in records[:5]:
    print(f'  {r[0]}  ZH={r[2][:20]}  EN={r[3][:35]}')
