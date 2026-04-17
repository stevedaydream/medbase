import sqlite3, unicodedata

db = sqlite3.connect(r'c:/Users/User/AppData/Roaming/com.medbase.app/medbase.db')
rows = db.execute("SELECT code, description_zh, description_en FROM icd_codes").fetchall()
count = 0
for code, zh, en in rows:
    nzh = unicodedata.normalize('NFKC', zh or '')
    nen = unicodedata.normalize('NFKC', en or '')
    if nzh != (zh or '') or nen != (en or ''):
        db.execute("UPDATE icd_codes SET description_zh=?, description_en=? WHERE code=?", [nzh, nen, code])
        count += 1
db.commit()
db.close()
print(f"修正 {count} 筆")