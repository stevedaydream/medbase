"""
確認 items_purpose_dept.xlsx 後執行此腳本匯回資料庫。
用法：python data/import_purpose_dept.py
"""
import sqlite3, openpyxl
from collections import Counter

DB  = r'C:\Users\User\AppData\Roaming\com.medbase.app\medbase.db'
XLS = r'G:\project\medbase\data\items_purpose_dept.xlsx'

wb = openpyxl.load_workbook(XLS, data_only=True)
ws = wb.active

conn = sqlite3.connect(DB)
updated_purpose = updated_depts = skipped = 0

for row in ws.iter_rows(min_row=2, values_only=True):
    hcode, _, _, purpose, depts_raw, _, _ = row
    if not hcode: continue

    hcode = str(hcode).strip()

    # 更新 purpose
    p = str(purpose).strip() if purpose else None
    conn.execute("UPDATE items SET purpose=? WHERE hospital_code=?", [p, hcode])
    updated_purpose += conn.execute("SELECT changes()").fetchone()[0]

    # 更新 item_depts
    conn.execute("DELETE FROM item_depts WHERE hospital_code=?", [hcode])
    if depts_raw:
        depts = [d.strip() for d in str(depts_raw).split(';') if d.strip()]
        for dept in depts:
            conn.execute(
                "INSERT OR IGNORE INTO item_depts (hospital_code, dept) VALUES (?,?)",
                [hcode, dept]
            )
            updated_depts += 1
    else:
        skipped += 1

conn.commit()

# 統計
purposes = conn.execute(
    "SELECT purpose, COUNT(*) c FROM items GROUP BY purpose ORDER BY c DESC"
).fetchall()
depts = conn.execute(
    "SELECT dept, COUNT(*) c FROM item_depts GROUP BY dept ORDER BY c DESC"
).fetchall()
conn.close()

print(f"purpose 更新：{updated_purpose} 筆")
print(f"item_depts 寫入：{updated_depts} 筆")
print(f"無科別（空）：{skipped} 筆\n")

print("Purpose 分布：")
for p, c in purposes:
    print(f"  {p or '（空）':20} {c}")

print("\nDept 分布：")
for d, c in depts:
    print(f"  {d:15} {c}")
