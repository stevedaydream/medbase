"""
確認 items_dept_mapping.xlsx 的 dept 欄後執行此腳本。
用法：python data/import_dept.py
"""
import sqlite3, openpyxl

DB  = r'C:\Users\User\AppData\Roaming\com.medbase.app\medbase.db'
XLS = r'G:\project\medbase\data\items_dept_mapping.xlsx'

wb = openpyxl.load_workbook(XLS, data_only=True)
ws = wb.active

conn = sqlite3.connect(DB)
updated = skipped = 0

for row in ws.iter_rows(min_row=2, values_only=True):
    hospital_code, _, _, _, _, dept = row[0], row[1], row[2], row[3], row[4], row[5]
    if not hospital_code:
        continue
    if not dept:
        skipped += 1
        continue
    conn.execute(
        "UPDATE items SET dept=? WHERE hospital_code=?",
        [str(dept).strip(), str(hospital_code).strip()]
    )
    updated += conn.execute("SELECT changes()").fetchone()[0]

conn.commit()

# 驗證
stats = conn.execute(
    "SELECT dept, COUNT(*) c FROM items GROUP BY dept ORDER BY c DESC"
).fetchall()
conn.close()

print(f"更新：{updated} 筆　略過：{skipped} 筆\n")
print("dept 分布：")
for r in stats:
    print(f"  {r[0] or '（未填）':12} {r[1]} 筆")
