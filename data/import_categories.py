"""
填好 items_no_category.xlsx 的 category / body_part 後執行此腳本。
用法：python data/import_categories.py
"""
import sqlite3
import openpyxl

DB  = r'C:\Users\User\AppData\Roaming\com.medbase.app\medbase.db'
XLS = r'G:\project\medbase\data\items_no_category.xlsx'

wb = openpyxl.load_workbook(XLS, data_only=True)
ws = wb.active

updated = skipped = 0
conn = sqlite3.connect(DB)

for row in ws.iter_rows(min_row=2, values_only=True):
    hospital_code, name_zh, name_en, category, body_part = row[0], row[1], row[2], row[3], row[4]
    if not hospital_code:
        continue
    if not category and not body_part:
        skipped += 1
        continue
    conn.execute(
        "UPDATE items SET category=?, body_part=? WHERE hospital_code=?",
        [
            str(category).strip() if category else None,
            str(body_part).strip() if body_part else None,
            str(hospital_code).strip(),
        ],
    )
    updated += conn.execute("SELECT changes()").fetchone()[0]

conn.commit()
conn.close()

print(f"更新：{updated} 筆")
print(f"略過（未填）：{skipped} 筆")
