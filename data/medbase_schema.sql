-- MedBase Normalized Schema
-- Auto-generated from items_parsed.xlsx
-- Tables: departments, doctors, items, sets, set_items

PRAGMA foreign_keys = ON;

-- ── departments ──────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE
);

-- ── doctors ──────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    department_id INTEGER REFERENCES departments(id)
);

-- ── items ────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
    hospital_code TEXT    PRIMARY KEY,
    name_en       TEXT,
    name_zh       TEXT,
    category      TEXT,
    body_part     TEXT,
    unit          TEXT,
    price         INTEGER,
    supplier      TEXT,
    notes         TEXT
);

-- ── sets ─────────────────────────────────────
-- set_type 由以下欄位推斷：
--   doctor_id=有, department_id=無  → 主治醫師個人常用
--   doctor_id=無, department_id=有  → 科別標準套組
--   doctor_id=有, department_id=有  → 科別下特定醫師常用
--   兩者皆無                        → 依術式通用套組
CREATE TABLE IF NOT EXISTS sets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    surgery_type  TEXT,
    doctor_id     INTEGER REFERENCES doctors(id),
    department_id INTEGER REFERENCES departments(id),
    notes         TEXT
);

-- ── set_items ────────────────────────────────
-- hospital_code: advisory reference only (not FK-enforced)
--   因套組耗材可能不在 items 主表中，故不設硬性 FK
-- quantity: NULL 表示 PRN（按需）
CREATE TABLE IF NOT EXISTS set_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id        INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    hospital_code TEXT,
    name_en       TEXT,
    name_zh       TEXT,
    quantity      INTEGER DEFAULT 1,
    price         INTEGER,
    notes         TEXT
);

-- ── indexes ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_items_category   ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_body_part  ON items(body_part);
CREATE INDEX IF NOT EXISTS idx_doctors_dept     ON doctors(department_id);
CREATE INDEX IF NOT EXISTS idx_sets_doctor      ON sets(doctor_id);
CREATE INDEX IF NOT EXISTS idx_sets_dept        ON sets(department_id);
CREATE INDEX IF NOT EXISTS idx_sets_surgery     ON sets(surgery_type);
CREATE INDEX IF NOT EXISTS idx_set_items_set    ON set_items(set_id);
CREATE INDEX IF NOT EXISTS idx_set_items_code   ON set_items(hospital_code);


-- ── INSERT doctors ─────────────────────────

INSERT INTO doctors (id, name, department_id) VALUES (1, '鄭正文', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (2, '曾兆寧', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (3, '原永健', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (4, '鄧修國', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (5, '劉哲瑋', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (6, '陳鍾沛', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (7, '內視鏡雷射(URSL、RIRS、Bladder stone)', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (8, '董RIRS:3 蔡RIRS:1+4 唐RIRS:1+4+5', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (9, '王世鋒', NULL);
INSERT INTO doctors (id, name, department_id) VALUES (10, '蔡明霖乳房自費(兩種都要術後衣)', NULL);

-- ── INSERT items ───────────────────────────

INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A01701', 'LEGIS ENDO-BAG5*7', '大吉士檢體袋', NULL, NULL, NULL, 1020, NULL, '泌尿科腹腔鏡腎、輸尿管、腎囊切除');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A01702', NULL, '★曲克檢體袋(滅菌) COOK LAPSAC (STERILE) 8*10 /1500ML #G15949(054800)', '胸腔外科', NULL, NULL, 3250, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A01703', NULL, '★曲克檢體袋(滅菌) COOK LAPSAC (STERILE) 5*8 /750ML #G15656(054100)', '胸腔外科', NULL, NULL, 2405, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A03701', NULL, '★惠眾拋棄式腹腔鏡檢體套袋UNIMAX ENDO BAG 3*6#FEP13608', '腹腔鏡手術', NULL, NULL, 567, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A72101', NULL, '★冷凍微針氦氣及氬氣使用費-開力斐賽斯低溫手術系統及配件(機器)', 'l 肺腫瘤冷凍治療自費(一組+手術費20001)', NULL, NULL, 46753, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80406', NULL, '★佛朗惜眼補利服矽油 FCI PRODUCTION PURIFIED SILICONE OIL#S5.7570;S5.7170;S5.7160;S5.7560', NULL, NULL, NULL, 5623, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80606', '荷美敷0.8ml', '高黏度組織黏著劑(tissue aid)', NULL, '組織膠', NULL, 3295, NULL, '荷美敷0.8ml');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80610', NULL, '★DERMABOND', '傷口組織膠', NULL, NULL, 1485, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80612', 'Hyaloglide 1ML', '亞諾葛來防沾黏生物膠 1ML', NULL, NULL, NULL, 20265, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80613', 'Hyaloglide 2ML', '亞諾葛來防沾黏生物膠 2ML', NULL, NULL, NULL, 38200, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80614', NULL, 'Vit D3 憑單門診藥局領藥', NULL, NULL, NULL, NULL, '業務:楊肖麗0921-990-252', ' Q3H*8瓶');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80616', NULL, '0.8ML荷美敷高黏度組織黏著劑', NULL, NULL, NULL, 3295, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80623', '易德鎂INDERMIL', '易德鎂組織黏膠劑', NULL, '組織膠', NULL, 3480, NULL, '易德鎂INDERMIL');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80627', 'sideral forte int 30mg(30粒/盒)', '新鐵多膠囊(鐵劑)', NULL, NULL, NULL, NULL, '醫院採購(恆宜)分機#7021', ' 需要時提前申請');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80631', NULL, '凱恩斯德馬飛傷口黏著劑', NULL, '組織膠', NULL, 9750, NULL, 'Hernia');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A80635', NULL, '百麗愛麗敷皮膚黏膠', NULL, '組織膠', NULL, 1430, NULL, 'Hernia (董)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A85503', NULL, 'KEWPIE刻利淨檢餐食(3包/盒)CLEAR THROUGH(葷)  (在門診藥局)', '低渣代餐', NULL, NULL, 680, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A86011', 'ATK 100ml', '次氯酸傷口沖洗液100ml', NULL, NULL, NULL, 1350, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1A86012', 'ATK 500ml', '次氯酸傷口沖洗液500ml', NULL, NULL, NULL, 3055, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C00206', NULL, '好美得抗生素骨水泥', NULL, NULL, NULL, 27600, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03317', NULL, '艾羅麥 人工骨骼替代品 0.5cc', NULL, '人工骨', NULL, 10650, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03318', NULL, '艾羅麥 人工骨骼替代品 1cc', NULL, '人工骨', NULL, 20640, NULL, '(鄭主任用)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03324', NULL, '美瑞世人工骨 ', NULL, '人工骨', NULL, NULL, '催棟/信迪斯', '健保');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03355', 'Osteo-G 6cc', '台塑一號(調和式)', NULL, '人工骨', NULL, 4950, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03379', 'FDA prove', '台塑一號(顆粒狀) 5cc', NULL, '人工骨', NULL, 4545, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03380', NULL, '尼諾斯注射式人工骨3CC ', NULL, '人工骨', NULL, NULL, '催棟/信迪斯', '自費');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03381', NULL, '尼諾斯注射式人工骨5CC ', NULL, '人工骨', NULL, NULL, '催棟/信迪斯', '自費');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03386', 'NOVABONE PUTTY 2.5cc', '諾亞軟塊狀人工骨 2.5cc', NULL, '人工骨', NULL, 30870, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03387', 'NOVABONE PUTTY 5cc', '諾亞軟塊狀人工骨 5cc', NULL, '人工骨', NULL, 42000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03388', 'NOVABONE SYRINGE 2.5cc', '諾亞軟塊注射型人工骨 2.5cc', NULL, '人工骨', NULL, 37370, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03389', 'NOVABONE SYRINGE 5cc', '諾亞軟塊注射型人工骨 5cc', NULL, '人工骨', NULL, 52500, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03390', 'NOVABONE SYRINGE 10cc', '諾亞軟塊注射型人工骨 10cc', NULL, '人工骨', NULL, 66875, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03404', NULL, 'DBM 1CC 奧普天脫鈣骨基質泥/膠opeium DBM 1CC', NULL, '人工骨', NULL, 28792, '催棟/信迪斯', '鄭主任用DBM');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C03418', NULL, '台微醫喜瑞骨人工骨替代物', NULL, '人工骨', NULL, 3978, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C20201', NULL, '★信迪思鎖定骨釘', '胸腔外科', NULL, NULL, 5720, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C20303', 'screw', '2.4mm screw ', NULL, NULL, NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C22002', 'Distal radius', '遠端橈骨固定骨釘', NULL, NULL, NULL, 3000, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C22003', 'miniplate screw(自費)  ', '單支 Screw  ', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C22004', 'FNS', '信迪思股骨頸系統', NULL, NULL, NULL, 73360, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C23401', NULL, '3.5mm screw ', NULL, NULL, NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C25802', 'Acutrak Headless screw', '艾克曼加壓螺釘系統', NULL, '鋼板/plate', NULL, 21900, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C25923', 'Fiberwire', 'Fiberwire', '骨科', '髕骨', '組', 1950, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C25949', NULL, '縫合鉚釘', NULL, NULL, NULL, 27150, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C25953', 'JUGGERKNOT ', '邦美傑格縫合錨釘(阿基里斯腱)', NULL, NULL, NULL, 30000, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30501', 'TFNA (全自費)優先        ', '鈦合金股骨髓內釘', NULL, '髓內釘', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30526', 'A2FN (全自費)', '信迪思第二代順行股骨髄內釘', NULL, '髓內釘', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30528', 'ETN', '信迪思萬向脛骨髄內釘 ', NULL, '髓內釘', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30529', 'EHN', '信迪思萬向肱骨髄內釘', NULL, '髓內釘', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30533', 'Cephalomedullary Nail', '人工骨髓內釘', NULL, NULL, NULL, NULL, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30544', 'PFNAII (全自費)', '信迪思第二代長股骨髄內釘', NULL, '髓內釘', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30550', 'Antegrade Femoral Nail (A2FN)', '第二代股骨髓內釘', NULL, NULL, NULL, NULL, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C30615', 'TEN             ', '鈦合金彈性髓內釘( 4~15歲) ', NULL, '髓內釘', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C40101', NULL, '   信迪思左側肋骨骨板', '胸腔外科', NULL, NULL, 54600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C40102', NULL, '   信迪思右側肋骨骨板', '胸腔外科', NULL, NULL, 54600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41506', 'Clavicular plate', '信迪思鈦合金鎖骨鎖定加壓骨板 ', '骨科', '鎖骨', '組', 54558, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41507', 'Ti-Hook Plate', '3.5mm信迪思鈦合金鎖骨鉤桿鎖定加壓骨板', '骨科', '鎖骨', '組', 58500, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41508', '2.4 LDRP', '2.4mm 鈦合金手腕鎖定骨板系統(背側兩片) ', '骨科', '手腕', '組', 36000, '催棟/信迪斯', '掌側雙片');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41512', '2.0mm LCP Ulna plate', '第二代鈦合金尺骨鎖定加壓骨板', NULL, '尺骨', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41519', 'Pelvic', '不銹鋼鎖定加壓型骨盤骨板', NULL, '骨盤骨板', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41520', 'Pelvic Hook', '不銹鋼勾型加壓骨板', NULL, '骨盤骨板', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41521', 'ProximalTibia (內外側)', '鈦合金脛骨鎖定骨板系統', '骨科', '脛骨', '組', 76410, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41522', '3.5 Locking Calcaneal', '鈦合金跟骨鎖定骨板系統', NULL, '跟骨', NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41523', 'Philos', '鈦合金近端肱骨鎖定骨板系統', '骨科', '肱骨', '組', 83340, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41524', 'Olecranon LCP', '鈦合金鷹嘴突鎖定加壓骨板', '骨科', '鷹嘴突', '組', 81460, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41525', '2.4 head', '鈦合金近端橈骨鎖定加壓骨板', '骨科', '手腕', '組', 63690, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41526', '2.4花瓣', '2.4mm 鈦合金手腕鎖定骨板系統        ', '骨科', '手腕', '組', 62770, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41528', 'Distal radius', '遠端橈骨固定骨板', NULL, NULL, NULL, 58324, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C41529', 'Mini plate(自費)  ', 'Plate+screw ', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C42162', 'LCP HOOK Plate ', '62MM 鎖定加壓鉤狀骨板系統', '骨科', '鷹嘴突', '組', 56360, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C42327', '5.0mm LCP', '5.0mm 鈦合金鎖定加壓骨板系統', '骨科', '肱骨', '組', 60000, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C42328', '3.5mm LCP', '3.5mm 鈦合金鎖定加壓骨板系統', '骨科', '肱骨', '組', 46123, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C42803', 'Distal radius(DVR)', '遠端橈骨交叉互鎖式骨板', NULL, NULL, NULL, 65600, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C43510', 'TSP      ', '大轉子穩定骨板( 搭配DHS使用) ', NULL, NULL, NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50103', 'Biolox head', '陶瓷頭全人工髖關節', NULL, NULL, NULL, 75262, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50105', 'Total hip system', '陶瓷全人工髖關節組', NULL, NULL, NULL, 120008, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50106', 'Bipolar system', '陶瓷半人工髖關節', NULL, NULL, NULL, 69182, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50107', 'Total hip system', '陶瓷全人工髖關節', NULL, NULL, NULL, 69617, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50107 + M1C50211', 'CUP+MDM liner+inert+Ceramic head+STEM  ', 'THR+陶瓷+MDM(自費)  ', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50108', 'Revision total hip system', '陶瓷加長型全人工髖關節', NULL, NULL, NULL, 64914, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50211', 'MDM system', '髖關節高活動度墊片', NULL, NULL, NULL, 86700, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50310', 'CUP+INSERT+HEAD+STEM  ', 'THR(健保) ', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50316', 'Bipolar cup+head+stem  ', 'BIP(健保)  ', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50604', 'TKR+ X3 CS INSERT (自費)  ', '全人工膝關節脛骨超耐磨墊片', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50701', 'LISS             ', '微創固定系統(股骨下端及脛骨上端)', '骨科', '脛骨', '組', 83670, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50807', 'Mini Tight Rope', 'Mini Tight Rope', '骨科', NULL, '組', 37000, '催棟/信迪斯', '鄭正文');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50912', 'FEMORAL+TIBIAL+PATELLA+INSERT  ', 'TKR(健保)  ', NULL, NULL, NULL, NULL, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C50965', 'Prolong Insert', '全人工膝關節超耐磨墊片', NULL, NULL, NULL, 63626, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51104', 'Proximal humerus', '近端肱骨鋼板', NULL, '肱', NULL, 64860, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51105', 'Patella', '下肢骨骨板組 ', NULL, '髕骨', NULL, 64580, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51106', 'Hook plate', '鎖骨鉤式骨板', NULL, '鎖骨', NULL, 45708, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51108', 'Dynamic compression locking plate(DCP)', NULL, NULL, '其他', NULL, 48512, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51109', 'Clavicle ', '艾克曼貼附鎖骨骨板系統', NULL, '鋼板/plate', NULL, 67500, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51110', 'Ulna shortening', '艾克曼貼附尺骨矯正骨板 ', NULL, '鋼板/plate', NULL, 71186, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51111', 'Radius shaft', '艾克曼貼附性前臂骨板系統-中段橈骨 ', NULL, '鋼板/plate', NULL, 52500, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51112', 'Ulna shaft', '艾克曼貼附性前臂骨板系統-中段尺骨', NULL, '鋼板/plate', NULL, 52500, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51113', 'Distal humerus', '艾克曼梅約貼附性肘骨板-遠端肱骨', NULL, '鋼板/plate', NULL, 68200, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51114', 'Olecranon', '艾克曼梅約貼附性骨板-鷹嘴突骨', NULL, '鋼板/plate', NULL, 68200, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51115', 'Distal radius', '艾克曼貼附骨板系統(遠端橈骨)', NULL, '鋼板/plate', NULL, 71186, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51117', 'Coronoid plate', '艾克曼梅約貼附性肘骨板-冠狀突骨', NULL, '鋼板/plate', NULL, 49500, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51118', 'Radial head', '艾克曼橈骨頭骨板', NULL, '鋼板/plate', NULL, 49500, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51122', 'Mini Plate', '艾克曼貼附骨板系統-骨板', NULL, '鋼板/plate', NULL, 63000, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51601 ', '2.4 LDRP', '2.4mm 鈦合金手腕鎖定骨板系統(掌側單片) ', '骨科', '手腕', '組', 65710, '催棟/信迪斯', '背側單片');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51607', '2.4 VA', '2.4mm 鈦合金可變角度鎖定加壓骨板系統', '骨科', '手腕', '組', 68200, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51702', 'R.A.F', '遠端橈骨解剖型鋼板', NULL, NULL, NULL, 60920, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51703', 'Radial head', '金屬肱尺骨手肘系統鎖定骨板', NULL, NULL, NULL, 67184, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51704', 'Ankle plate', '脛骨遠端外側鎖定骨板(雙鈎)', NULL, '踝', NULL, 66210, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51705', 'Mini plate', NULL, NULL, NULL, NULL, 51250, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51706', 'Headless screw', NULL, NULL, NULL, NULL, 14400, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51709', NULL, '埋頭釘', NULL, NULL, NULL, NULL, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51711', 'CAS&CAM', '遠端鎖骨鉤鎖定鋼板(含骨幹解剖型鋼板)', NULL, NULL, NULL, 66500, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51712', '3A nail(PFN)全自費', '解剖型髓內釘系統組', NULL, '髖', NULL, 83600, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C51714', 'APS SPEAR LOCKING PLATE ', '矛型微型鎖定骨板(鄧:拇指外翻)', NULL, NULL, NULL, 50000, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C52101', 'Ankle locking plate', '艾克曼解剖貼附性骨板-下肢脛骨骨板 ', NULL, '鋼板/plate', NULL, 67150, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C52102', 'Calcaneal', '艾克曼貼附性下肢骨板系統-互鎖式骨板', NULL, '鋼板/plate', NULL, 67150, '韶田/Acumed', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C52104', 'Distal Fibula (Malleolar)', '鈦合金鎖定加壓遠端腓骨骨板系統', '骨科', '腓骨', '組', 72250, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C53101', NULL, '15釘) #0113115 巴德速巴定腹腔鏡可吸收性固定系統 BARD ENHANCED SORBAFIX ABSORBABLE FIXATION SYSTEM', '黃顧問 TAPP 套組', NULL, NULL, 12540, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C53105', NULL, '★(15釘) 5MM #ABSTACK15 柯惠單一使用可吸收固定釘 ', NULL, NULL, NULL, 18160, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C53601', 'Distal Femur locking plate', '阿爾卑斯近端脛骨 互鎖式骨板系統', NULL, NULL, NULL, 58850, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C55352', 'VA-LCP Clavicle Plate', '信迪思多角度鎖定加壓鎖骨骨板系統', '骨科', '鎖骨', '組', 81575, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C55353', '1.0/1.5/2.0mm (Mini plate) ', '1.0/1.5/2.0mm 鈦合金骨板系統 ', '骨科', '掌骨', '組', 51625, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C56701', 'Philos', '鈦合金近端肱骨鎖定骨板系統(VS同意健保給付)', '骨科', '肱骨', '組', 67500, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1C56702', '3.5 DH', '3.5mm 鈦合金肱骨下端鎖定骨板系統', '骨科', '肱骨', '組', 86100, '催棟/信迪斯', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1F11106', NULL, '★COVIDIEN 柯惠GIA自動手術縫合器-戴', NULL, NULL, NULL, 3358, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1F25809', 'VISCOSEAL SYNOVIAL FLUID SUBSTITUTE#10ML', '維骨適膝關節腔滑液替代物', NULL, '玻尿酸', NULL, 27720, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1F30101', NULL, '★冷凍微針-開力斐賽斯低溫手術系統及配件(針)', 'l 肺腫瘤冷凍治療自費(一組+手術費20000)', NULL, NULL, 41240, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1G21707', NULL, '★優施西可吸收傷口縫合裝置(僅開放性手術使用) USS V-LOC 180 ABSORBABLE WOUND CLOSURE DEVICE 30CM #GS21(VLOCL0316)', 'V-Lock (免打結縫線)', NULL, NULL, 1800, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1G21728', 'Absorbable wound closure device', '柯惠可吸收傷口縫合裝置(梁爺)', NULL, NULL, NULL, 1600, 'Stryker', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1G25201', NULL, '#SXPP1A401:425 愛惜康抗菌免打結傷口縫合裝置ETHICON STRATAFIX SYMMETRIC PDS PLUS KNOTLESS TISSUE CONTROL DEVICE', '藍鑽魚骨線 (Stratafix) (免打結縫線)', NULL, NULL, 2505, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1H40912', 'PRP', '馬旺血小板血漿收集容器套組', NULL, NULL, NULL, 16500, '愛派司A+', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1K61403', NULL, '★柯惠亞羅胸腔引流瓶 (滅菌)', '胸腔外科', NULL, NULL, 3900, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1L20902', 'Smith& Nephew', '非動力式可攜帶抽吸器具', NULL, NULL, NULL, 1996, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1L21201', NULL, '訊息型負壓輔助癒合治療儀-滲液收集罐(500ML)', NULL, NULL, NULL, 1997, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1L21202', NULL, '活動型負壓輔助癒合治療儀-滲液收集罐(300ML)', NULL, NULL, NULL, 1997, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1L21203', '潔利定Genadyne', '負壓傷口治療系統-可攜帶式集液瓶(600ML)', NULL, NULL, NULL, 1920, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1L40202', NULL, '波士頓科技聖古拉取石網', NULL, NULL, NULL, 6563, NULL, 'PCNL/URSL');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1M00602', NULL, '多波光', NULL, NULL, NULL, NULL, NULL, 'TURP lacer');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1M05202', NULL, '銩光(量子雷射)', NULL, NULL, NULL, NULL, NULL, 'TURP lacer');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1M25931', NULL, '★電漿刀 PEAK', NULL, NULL, NULL, 18980, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1M31823', NULL, '★7G:10G聖芮絲安可兒探針與附件SENORX ENCOR PROBE+ACC-ENCOR PROBE#ECP01-7G:10G (包含真空沖洗管收納盒與膠卷罐)', '真空乳房探針(手術費33500+探針套組18000)', NULL, NULL, 18000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1N02709', NULL, '★23G #3235 明德望矽油注射微細針頭 MEDONE POLY TIP VFI CANNULA', NULL, NULL, NULL, 930, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1N06102', NULL, '★矽油加壓推進管套組 #1363DD VFI PACK FOR SILICONE OIL SYRINGES', NULL, NULL, NULL, 6240, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1N22804', NULL, '★百特克沾黏溶液 BAXTER ADEPT 4% ICODEXTRIN SOLUTION 1.5L #1501573', NULL, NULL, NULL, 14980, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1N25301', NULL, '★健臻防粘黏薄膜13*15CM', NULL, NULL, NULL, 15000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1N25302', NULL, '★健臻防沾黏薄膜 7*13 cm', NULL, NULL, NULL, 28400, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1N28102', NULL, '★聚乳酸防沾黏膜(大)-陳、戴', NULL, NULL, NULL, 18428, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1R02316', NULL, '★(攜回)#SOPHIA(S:2XL)靖騰凱菲術後衣(未滅菌)GENTEK CAREFIX POST-SURGICAL BRA(NON-STERILE)  (Sophia)', '乳癌術後衣', NULL, NULL, 8000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1R02317', NULL, '★(攜回)#MARY(S:4XL)靖騰凱菲術後衣(未滅菌)GENTEK CAREFIX POST-SURGICAL BRA(NON-STERILE) (Mary)', '乳癌術後衣', NULL, NULL, 8000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01209', 'Spongostant Power', '飛洛散斯龐嘉止血粉', NULL, NULL, NULL, 15000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01211', NULL, '★愛惜康斯爾止可吸收性止血粉Ethicon SURGICEL Powder Absorbable Haemostatic Powder 3g#3023SP', NULL, NULL, NULL, 25400, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01926', NULL, '癒立安膠原蛋白敷料(20X40X3MM)', NULL, NULL, NULL, 14274, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01927', NULL, '癒立安膠原蛋白敷料(50X50X3MM)', NULL, NULL, NULL, 22429, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01928', NULL, '癒立安膠原蛋白敷料(100X100X3MM)', NULL, NULL, NULL, 36808, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01929', NULL, '癒立安膠原蛋白敷料(1CC)', NULL, NULL, NULL, 9485, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01930', NULL, '癒立安膠原蛋白敷料(2CC)', NULL, NULL, NULL, 15006, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01931', NULL, '癒立安膠原蛋白敷料(5CC)', NULL, NULL, NULL, 32703, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01932', 'Heraderm', '赫麗敷水性傷口敷料 5ML', NULL, NULL, NULL, 2470, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01933', 'Heraderm', '赫麗敷水性傷口敷料 10ML', NULL, NULL, NULL, 3900, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01936', 'Prisma', '耐敷吉膠原蛋白傷口敷料(30X35MM)', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S01937', NULL, '耐敷吉膠原蛋白傷口敷料(60X60MM)', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02130', 'New Epi 5ml', '生長因子5ml', NULL, NULL, NULL, 6375, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02131', 'New Epi 10ml', '生長因子10ml', NULL, NULL, NULL, 11688, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02504', 'Smith& Nephew', '負壓傷口治療小型敷料', NULL, NULL, NULL, 2600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02505', 'Smith& Nephew', '負壓傷口治療中型敷料', NULL, NULL, NULL, 2900, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02506', 'Smith& Nephew', '負壓傷口治療中大型敷料', NULL, NULL, NULL, 3000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02507', '凱西爾KCI', '負壓輔助癒合敷料(小)', NULL, NULL, NULL, 2600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02508', NULL, '負壓輔助癒合敷料(中)', NULL, NULL, NULL, 2900, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02509', NULL, '負壓輔助癒合敷料(大)', NULL, NULL, NULL, 3000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1S02510', NULL, '負壓傷口治療系統-泡棉組', NULL, NULL, NULL, 2733, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1U00103', 'Density', '特適體(憑單門診藥局領藥)', NULL, NULL, NULL, 2680, NULL, 2);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1V00357', NULL, '波士頓科技斯伯泌尿科引導鋼線', NULL, NULL, NULL, 982, NULL, 'PCNL');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1W58007', NULL, '★超音波刀(Harmonic) 36cm(腹腔鏡用)', 'Harmonic 系列 (Ethicon，J&J)', NULL, NULL, 28600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1W58008', NULL, '★超音波刀(Harmonic/一體成型36cm)(Scopy用)', 'Harmonic 系列 (Ethicon，J&J)', NULL, NULL, 32500, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1W60605', NULL, '★超音波刀(Harmonic) 17cm(Lapa用)', 'Harmonic 系列 (Ethicon，J&J)', NULL, NULL, 27300, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1W60607', NULL, '★超音波刀(Harmonic) 9cm(痔瘡用)', 'Harmonic 系列 (Ethicon，J&J)', NULL, NULL, 26330, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1W60609', NULL, '★柯惠索尼西迅無線超音波(13cm)(26cm) Anal+Lapar用', 'Anal CRS', NULL, NULL, 37840, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1W93602', NULL, '★史賽克超音波手術裝置-探頭', NULL, NULL, NULL, 29938, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02101', 'Biobrane', '史耐輝必膚膜13*13', NULL, NULL, NULL, 3060, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02102', 'Biobrane', '史耐輝必膚膜13*38', NULL, NULL, NULL, 5737, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02112', '顏主任', 'Terudermis 2.5*2.5', NULL, NULL, NULL, 5560, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02113', NULL, 'Terudermis 2.5*5', NULL, NULL, NULL, 5850, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02114', NULL, 'Terudermis 5*5', NULL, NULL, NULL, 11875, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02124', 'Dermacell 2*4CM', '去細胞真皮組織 2*4CM', NULL, NULL, NULL, 30912, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02125', 'Dermacell 4*4CM', '去細胞真皮組織 4*4CM', NULL, NULL, NULL, 40480, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02126', 'Dermacell 4*7CM', '去細胞真皮組織 4*7CM', NULL, NULL, NULL, 80960, NULL, '整形外科');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02134', NULL, '無矽膠單層5*5CM', NULL, NULL, NULL, 13842, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02135', NULL, '薄型無矽膠單層5*5CM', NULL, NULL, NULL, 13842, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02136', NULL, '矽膠雙層5*5CM', NULL, NULL, NULL, 13842, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02137', NULL, 'Meshed矽膠雙層5*5CM', NULL, NULL, NULL, 13842, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02138', NULL, '無矽膠單層10*12.5CM', NULL, NULL, NULL, 51073, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02139', NULL, '薄型無矽膠單層10*12.5CM', NULL, NULL, NULL, 51073, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02140', NULL, '矽膠雙層10*12.5CM', NULL, NULL, NULL, 51073, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X02141', NULL, 'Meshed矽膠雙層10*12.5CM', NULL, NULL, NULL, 51073, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X152692', NULL, '★巴德凡萃歐絲提疝氣補片BARD VENTRIO ST HERNIA (11CM*14CM)', 'Ventral hernia mesh', NULL, NULL, 27977, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50107', NULL, '★14X14CM#SXPD2B414愛惜康思達飛外科用可吸收傷口吻合裝置(羽毛線)', '黃顧問 TAPP 套組', NULL, NULL, 1648, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50112', NULL, '傷口沖洗器', NULL, NULL, NULL, 4425, 'Zimmer', NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50202', 'Prevena', '佩威家術後傷口照護系統(20cm)', NULL, NULL, NULL, 23750, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50203', NULL, '佩威家術後傷口照護系統(90cm)', NULL, NULL, NULL, 24375, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50912', NULL, '★柯惠 GIA自動手術縫合器-旋轉式釘匣45MM-戴', NULL, NULL, NULL, 5792, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50924', NULL, '★45MM#EGIA45AMT;EGIA45AVM柯惠內視鏡自動手術縫合釘 (紫釘)', '胸腔外科', NULL, NULL, 14700, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X50925', NULL, '60MM#EGIA60AVM(2-3MM);EGIA60AMT柯惠內視鏡自動手術縫合釘', '胸腔外科', NULL, NULL, 14700, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51215', NULL, '★壯生拋棄式腹腔安全穿刺針 #PN120 (醫院吸收不用再簽了)', '腹腔鏡手術', NULL, NULL, 1350, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51223', 'ETHICON HANDLE', '愛惜康安德派思電灼手術器械', NULL, NULL, NULL, 5460, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51224', 'ETHICON SHAFT', '愛惜康安德派思電灼手術器械', NULL, NULL, NULL, 3900, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51901', NULL, '★射頻燒灼手術(Habib)-全新切肝', NULL, NULL, NULL, 10908, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51903', NULL, '★腫瘤燒灼電極針(Talon RFA 4cm)', NULL, NULL, NULL, 66000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51904', NULL, '★腫瘤燒灼電極針(XL RFA 5cm)', NULL, NULL, NULL, 52800, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X51907', NULL, '★單極電針專用貼片(以上RFA都需加價此貼片)', NULL, NULL, NULL, 4800, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52605', 'TEP腹腔鏡(強)', 'TEP腹腔鏡自黏式(魔鬼沾)MESH', NULL, 'Hernia人工網膜', NULL, 28000, NULL, 'TEP腹腔鏡(強)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52636', NULL, '★4.2*6.2 #0134460 巴德腹腔鏡用康柏斯輕質型修補網 BARD COMPOSIX L/P MESH', '戴鋒泉臍疝氣', NULL, NULL, 15200, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52637', NULL, '★6.2*8.2 #0134680 巴德腹腔鏡用康柏斯輕質型修補網 BARD COMPOSIX L/P MESH', '戴鋒泉臍疝氣', NULL, NULL, 29200, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52641', NULL, '★COOK MESH ', 'Inguinal mesh', NULL, NULL, 10700, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52646', NULL, '★UHSM MESH', 'Inguinal mesh', NULL, NULL, 12600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52647', 'UHS(鋒)', '愛惜康優全補疝氣系統', NULL, 'Hernia人工網膜', NULL, 12600, NULL, 'UHS(鋒)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52656', NULL, '★B/BRAUM MESH', 'Inguinal mesh', NULL, NULL, 9281, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52662', NULL, '★BARD MESH plug light M/Là健保', 'Inguinal mesh', NULL, NULL, 5460, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52674', NULL, '★20*15CM #PCO2015F 舒法定帕瑞得複合式人工編網 SOFRADIM PARIETEX COMPOSITE MESHES', NULL, NULL, NULL, 38880, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52680', NULL, '★15*10CM #PCO1510F 舒法定帕瑞得複合式人工編網 SOFRADIM PARIETEX COMPOSITE MESHES', NULL, NULL, NULL, 37310, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52684', NULL, '★ 豪爾亞賀邁奇網片HERNIAMESH HERMESH 7 SURGICAL MESH#H71515(15X15CM) (常用)', NULL, NULL, NULL, 11880, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52690', NULL, '★巴德凡萃歐絲提疝氣補片BARD VENTRIO ST HERNIA (8CM*12CM)', 'Ventral hernia mesh', NULL, NULL, 17907, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X52691', NULL, '★巴德凡萃歐絲提疝氣補片BARD VENTRIO ST HERNIA (13.8CM*17.8CM', 'Ventral hernia mesh', NULL, NULL, 32487, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X54006', NULL, '★可彎式電動腔鏡直線型切割縫合器(適用有血管的如肺葉切除)', '胸腔外科', NULL, NULL, 25125, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X54021', NULL, '利膚來可拆除式皮膚縫合釘(滅菌)', NULL, NULL, NULL, 8500, NULL, 'Dr.原免縫');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55013', NULL, '★腹壁牽引器(小) 2.5-6cm', NULL, NULL, NULL, 2400, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55014', NULL, '★腹壁牽引器(中) 5-9cm', NULL, NULL, NULL, 3000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55015', NULL, '★腹壁牽引器(大)9-14cm', NULL, NULL, NULL, 3450, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55018', NULL, '★ 特小號2-4CM柯惠傷口保護套COVIDIEN SURGISLEEVE WOUND PROTECTOR#WPXSM24', '胸腔外科', NULL, NULL, 3640, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55204', 'ETICON #PHSM(鋒)', '疝氣人工網', NULL, 'Hernia人工網膜', NULL, 9630, NULL, 'ETICON #PHSM(鋒)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55205', 'ETICON #PHSL(鋒)', '疝氣人工網', NULL, 'Hernia人工網膜', NULL, 9675, NULL, 'ETICON #PHSL(鋒)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55211', NULL, '★6.4CMX6.4CM(中)巴德凡提拉斯特疝氣修補網', '臍疝氣MESH', NULL, NULL, 17500, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55216', NULL, '★巴德立體輕質型修補網BARD 3DMAX LIGHT MESH#0', 'Inguinal mesh', NULL, NULL, 9316, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55220', NULL, '★百歐瑟二氧化鈦疝氣修補網TIO2MESH SURGICAL MESH IMPLANT10x15CM #MFP111', NULL, NULL, NULL, 12540, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55221', 'TEP腹腔鏡(鋒)', 'TEP腹腔鏡MESH', NULL, 'Hernia人工網膜', NULL, 18900, NULL, 'TEP腹腔鏡(鋒)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55224', NULL, '★可吸收組織修補片Neoveil ', NULL, NULL, NULL, 34072, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55228', NULL, '★Modified Onflex', 'Inguinal mesh', NULL, NULL, 11800, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55230', NULL, '★60CM愛惜康得美棒皮膚接合自黏網片系統ETHICON DERMABOND PRINEO SKIN CLOSURE SYSTEM#CLR602', '傷口組織膠', NULL, NULL, 15920, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55231', NULL, '百麗愛麗膚手術傷口封合系統 Exofin Fusion Closure System#22cm', NULL, NULL, NULL, 13750, NULL, 'Dr.鄧免逢');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55232', NULL, '百麗愛麗膚手術傷口封合系統Exofin Fusion Closure System#30cm', NULL, NULL, NULL, 20000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55233', 'TEP腹腔鏡(鋒)', 'TEP MICROVAL 3D人工網膜', NULL, 'Hernia人工網膜', NULL, 33600, NULL, 'TEP腹腔鏡(鋒)');
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55411', NULL, '★ETHICON ENDO SURGERY普克美釘合器 (Hemo PPH)', NULL, NULL, NULL, 20350, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55714', NULL, '★愛惜康愛喜龍可彎式高階定位電動血管縫合器ETHICON ECHELON FLEX POWERED VASCULAR STAPLER#PVE35A (血管槍)', '胸腔外科', NULL, NULL, 24725, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X55715', NULL, '★愛惜康愛喜龍環形電動吻合器Ethicon Echelon Circular Powered Staplers#23:31mm', NULL, NULL, NULL, 21584, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1X56702', NULL, '★拋棄式腹腔沖吸引流套管組', NULL, NULL, NULL, 2300, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00411', NULL, '★德亞瑞絲達可吸收止血顆粒BARD ARISTA AH ABSORBABLE HEMOSTATIC PARTICLES#SM0005-USA(1G)', NULL, NULL, NULL, 10845, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00412', NULL, '★德亞瑞絲達可吸收止血顆粒BARD ARISTA AH ABSORBABLE HEMOSTATIC PARTICLES#SM0005-USA(3G)', NULL, NULL, NULL, 21600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00413', NULL, '★德亞瑞絲達可吸收止血顆粒BARD ARISTA AH ABSORBABLE HEMOSTATIC PARTICLES#SM0005-USA(5G)', NULL, NULL, NULL, 35000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00420', NULL, '★斯爾弗止血劑SURGIFLO HEMOSTATIC MATRIX#MS0010(8ML)', NULL, NULL, NULL, 22978, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00423', NULL, '百歐瑟宜莫斯加強型止血及防沾黏粉-3克BioCer HaemoCer PLUS haemostatic powder-3g', NULL, NULL, NULL, 19480, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00424', NULL, '百歐瑟宜莫斯加強型止血及防沾黏粉-5克BioCer HaemoCer PLUS haemostatic powder-5g', NULL, NULL, NULL, 25400, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00425', NULL, '百歐瑟宜莫斯加強型止血及防沾黏粉-440mm投藥器(腹腔鏡使用)', NULL, NULL, NULL, 2514, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z00426', NULL, '百歐瑟宜莫斯加強型止血及防沾黏粉-180mm投藥器(開腹腔鏡需使用)', NULL, NULL, NULL, 2094, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z01103', 'Amnion Matrix Allograft', '羊膜異體移植物-20mg', NULL, '注射物', NULL, 34800, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z01104', 'AmnioFi', '羊膜絨毛膜 注射型40MG', NULL, '注射物', NULL, 56100, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z01105', NULL, '注射型100MG', NULL, NULL, NULL, 110000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z01106', NULL, '薄膜型16MM', NULL, NULL, NULL, 51700, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z01107', NULL, '薄膜型2*3MM', NULL, NULL, NULL, 67100, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z01108', NULL, '薄膜型3*3MM', NULL, NULL, NULL, 72600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z04203', 'DBM 1cc', '美晶技生生長因子人工骨 1cc', NULL, '人工骨', NULL, 35700, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z04204', 'DBM 5cc', '美晶技生生長因子人工骨 5cc', NULL, '人工骨', NULL, 79860, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z04205', 'DBM 0.5cc', '美晶技生生長因子人工骨 0.5cc', NULL, '人工骨', NULL, 23792, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z50302', 'Baxter Tisseel 2ML', '百特組織修復凝合劑 2ML', NULL, NULL, NULL, 18125, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z50304', 'Baxter Tisseel 4ML', '百特組織修復凝合劑 4ML', NULL, NULL, NULL, 24600, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z50305', 'Baxter Tisseel 10ML', '百特組織修復凝合劑 10ML', NULL, NULL, NULL, 35000, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z50307', 'Veraseal Solution', '薇樂欣凝合劑(止血劑)#2ml', NULL, NULL, NULL, 21875, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z50308', NULL, '薇樂欣凝合劑(止血劑)#4ml', NULL, NULL, NULL, 32400, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('M1Z52809', 'Stripping laser', '靜脈曲張雷射吉恩司二極體雷射', NULL, NULL, NULL, 41800, NULL, NULL);
INSERT INTO items (hospital_code, name_en, name_zh, category, body_part, unit, price, supplier, notes) VALUES ('T1015700', 'V.A.C', '真空吸引傷口處置', NULL, NULL, NULL, NULL, NULL, '病房開單入帳');

-- ── INSERT sets ────────────────────────────

INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (1, '鄭正文 - TKR', 'TKR', 1, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (2, '鄭正文 - THR/bipolar', 'THR/bipolar', 1, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (3, '曾兆寧 - TKR', 'TKR', 2, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (4, '曾兆寧 - THR/bipolar', 'THR/bipolar', 2, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (5, '原永健 - THR/bipolar', 'THR/bipolar', 3, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (6, '鄭正文 - 肩關節鏡', '肩關節鏡', 1, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (7, '鄭正文 - 膝關節鏡', '膝關節鏡', 1, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (8, '鄧修國 - 肩關節鏡', '肩關節鏡', 4, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (9, '鄧修國 - 膝關節鏡', '膝關節鏡', 4, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (10, '劉哲瑋 - spine endoscopy', 'spine endoscopy', 5, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (11, '劉哲瑋 - spine endoscopy laminectomy', 'spine endoscopy laminectomy', 5, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (12, '劉哲瑋 - Kyphoplasty', 'Kyphoplasty', 5, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (13, '陳鍾沛 - Spine內視鏡', 'Spine內視鏡', 6, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (14, '內視鏡雷射(URSL、RIRS、Bladder stone)', NULL, 7, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (15, '董RIRS:3 蔡RIRS:1+4 唐RIRS:1+4+5', NULL, 8, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (16, '王世鋒 - 腹腔鏡腎囊切除術', '腹腔鏡腎囊切除術', 9, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (17, '蔡明霖乳房自費(兩種都要術後衣) - 全切', '全切', 10, NULL, NULL);
INSERT INTO sets (id, name, surgery_type, doctor_id, department_id, notes) VALUES (18, '蔡明霖乳房自費(兩種都要術後衣) - BCT', 'BCT', 10, NULL, NULL);

-- ── INSERT set_items ───────────────────────

INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (1, 1, 'M1C50965', 'Prolong Insert', '全人工膝關節超耐磨墊片', 1, 63626, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (2, 1, 'M1C00206', NULL, '好美得抗生素骨水泥', 1, 27600, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (3, 1, 'M1Z00420', 'Surgiflo', '斯爾弗止血劑', 2, 22975, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (4, 2, 'M1C50107', 'Total hip system', '陶瓷全人工髖關節', 1, 69617, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (5, 2, 'M1C50106', 'Bipolar system', '陶瓷半人工髖關節', 1, 69182, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (6, 2, 'M1Z00420', 'Surgiflo', '斯爾弗止血劑', 2, 22975, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (7, 2, 'M1C50211', 'MDM System', '髖關節高活動墊片 (主任有說才用)', 1, 86700, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (8, 3, 'M1C50965', 'Prolong Insert', '全人工膝關節超耐磨墊片', 1, 63626, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (9, 3, 'M1C00223', NULL, '奧斯特抗生素骨水泥', 1, 17850, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (10, 3, 'M1Z00424', 'biocer Haemocer', '百歐瑟宜莫斯 止血及防沾黏粉-5g', 1, 25400, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (11, 4, 'M1C50103', 'Biolox head', '陶瓷頭全人工髖關節', 1, 75262, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (12, 4, 'M1C00223', NULL, '奧斯特抗生素骨水泥 (VS原、鄧)', 1, 36036, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (13, 4, 'M1Z00424', 'biocer Haemocer', '百歐瑟宜莫斯 止血及防沾黏粉-5g', 1, 25400, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (14, 4, 'M1A80612', 'Anti-adhesion Gel', '亞諾葛來防沾黏生物膠1ml', 1, 20265, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (15, 4, 'M1N25310', 'MAST Adhesion  Barrier Film', '馬適得可吸收防沾黏薄膜', 1, 30000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (16, 5, 'M1Z00428', 'SURGIFLO with Thrombin', '斯爾弗止血基質組', 1, 39840, '2選1');
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (17, 5, 'M1Z00420', 'Surgiflo', '斯爾弗止血劑', 1, 22975, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (18, 6, 'M1C12503', 'Arthroscopy tubing', '靈威特關節鏡手術引水導管', 1, 3024, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (19, 6, 'M1C11912', 'Arthrocard', '關節鏡專用氣化棒探頭', 1, 21000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (20, 6, 'M1C25926', 'AR-6560cannula 5.75mm', '關節鏡專用套管', 1, 1625, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (21, 6, 'M1C13101', NULL, '無菌包布', 1, 1600, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (22, 6, 'M1C02421', 'BUR', '關節鏡鑽頭', 1, 6475, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (23, 6, 'M1C25947', 'SwiveLock 4.75mm', '思維拉克縫合錨釘', 1, 30750, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (24, 6, 'M1C25942', 'PALADIN', '帕拉丁縫合錨釘', 1, 15000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (25, 6, 'M1H40905', 'PRP', '利奇血球細胞分離組', 1, 15500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (26, 6, 'M1W73024', NULL, '拋棄式旋轉刮刀及磨刀', 1, 4970, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (27, 6, 'M1C50807', 'mini repair', '肌腱固定懸吊鈕', 1, 37000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (28, 6, 'M1C25949', 'ICONIX', '史賽克艾康尼斯縫合錨釘', 1, 25290, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (29, 7, 'M1C12503', 'Arthroscopy tubing', '靈威特關節鏡手術引水導管', 1, 3024, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (30, 7, 'M1C11912', 'Arthrocard', '關節鏡專用氣化棒探頭', 1, 21000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (31, 7, 'M1C50803', 'TightRope RT', '前十字韌帶懸吊韌帶固定紐', 1, 30800, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (32, 7, 'M1C26616', 'XO Button', '韌帶懸吊固定裝置', 1, 17500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (33, 7, 'M1H40905', 'PRP', '利奇血球細胞分離組', 1, 15500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (34, 7, 'M1C50801', NULL, '關節軔帶懸吊系統(人工韌帶)', 1, 72560, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (35, 7, 'M1C00904', 'Meniscal Cinch', '半月軟骨縫合修補器', 1, 21038, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (36, 7, 'M1W73024', NULL, '拋棄式旋轉刮刀及磨刀', 1, 4970, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (37, 7, 'M1C01501', 'CTS MEMTENDINOSUS TENDON', '異體韌帶', 1, 91300, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (38, 8, 'M1C12503', 'Arthroscopy tubing', '靈威特關節鏡手術引水導管', 1, 3024, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (39, 8, 'M1C11912', 'Arthrocard', '關節鏡專用氣化棒探頭', 1, 21000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (40, 8, 'M1C25958', 'ARTHREX PUSHLOCK SUTURE ANCHOR-PEEK PUSHLOCK', '艾思瑞斯普仕拉克縫合錨釘-不可吸收普仕拉克縫合錨釘', 1, 31900, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (41, 8, 'M1C25925', NULL, 'AR-1606三點懸臂式消毒袋', 1, 6000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (42, 8, 'M1C13101', NULL, '3M 骨科手術防護系統9021A', 1, 1600, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (43, 8, 'M1C25947', 'ARTHREX SWIVELOCK SUTURE ANCHORS', '艾思瑞斯思維拉克縫合錨釘', 1, 30750, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (44, 8, 'M1C25926', 'AR-6560 CRYSTAL CANNULA,5.75MM I.D.*7CM,STERILE', NULL, 1, 1625, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (45, 8, 'M1H40905', 'PRP', '利奇血球細胞分離組', 1, 15500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (46, 8, 'M1C25923', 'AR-7201 FIBERWIRE', NULL, 1, 1950, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (47, 9, 'M1C12503', 'Arthroscopy tubing', '靈威特關節鏡手術引水導管', 1, 3024, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (48, 9, 'M1C11912', 'Arthrocard', '關節鏡專用氣化棒探頭', 1, 21000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (49, 9, 'M1C00904', 'Meniscal Cinch', '半月軟骨縫合修補器', 1, 21038, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (50, 9, 'M1H40905', 'PRP', '利奇血球細胞分離組', 1, 15500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (51, 9, 'M1C50803', 'TightRope RT', '前十字韌帶懸吊韌帶固定紐', 1, 30800, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (52, 9, 'M1F25814', 'Oligo', '軟骨注射植入物', 1, 77000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (53, 9, 'M1C50807', 'ARTHREX MINI TIGHT-ROPE REPAIR SYSTEM', '艾思瑞斯迷你泰若普肌腱固定懸吊鈕', 1, 37000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (54, 9, 'M1C50802', 'ARTHREX TIGHT-ROPE SYNDESMOSIS REPAIR SYSTEM', '艾思瑞斯泰若普肌腱固定懸吊鈕', 1, 37500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (55, 10, 'M1C11912', 'Arthrocard', '關節鏡專用氣化棒探頭', 1, 21000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (56, 10, 'M1C12503', 'Arthroscopy tubing', '靈威特關節鏡手術引水導管', 1, 3024, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (57, 10, 'M1C51236', NULL, '鐿鈦脊椎固定系統:微創2節', 1, 94080, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (58, 10, 'M1C51237', NULL, '鐿鈦脊椎固定系統:微創3節', 1, 132480, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (59, 10, 'M1W73024', 'Shaver', '康美關節鏡手術拋棄式旋轉刮 刀及磨刀', 1, 4970, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (60, 10, 'M1X02605', 'Fziomed', '佛柔美得抗沾黏凝膠', 1, 39123, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (61, 10, 'M1Z04203', NULL, '美精技悠補骨補骨材料', 1, 29460, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (62, 10, 'M1S01209', NULL, '飛洛散斯龐嘉止血粉', 1, 15000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (63, 10, 'M1H40905', 'PRP', '利奇血球細胞分離組', 2, 15500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (64, 10, 'M1Z01104', 'AmnioFi', '羊膜絨毛膜 注射型40MG', 1, 56100, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (65, 10, 'M1Z01103', 'Amnion Matrix Allograft', '羊膜異體移植物-20mg', 1, 34800, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (66, 11, 'M1C12503', NULL, '靈威特關節鏡手術引水導管', 1, 3024, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (67, 11, 'M1Z01104', NULL, '羊膜絨毛膜 注射型40MG', 1, 56100, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (68, 11, 'M1G02924', NULL, '凡圖滋雙極射頻電極', 1, 71500, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (69, 11, 'M1Z00420', NULL, '斯爾弗止血劑SURGIFLO', NULL, 22978, 'PRN');
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (70, 12, 'M1C00213', 'IMEDICOM-CEMENT DISPENSER', '骨水泥分配器(已滅菌)氣球椎體成形術系統', 1, 71520, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (71, 12, 'M1C00219', 'TECRES MENDEC SPINE', '泰瑞斯蒙締客脊椎用成形骨泥', 1, 24000, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (72, 13, 'M1Z08602', 'Vaporflex', '高頻熱凝電燒', 1, 75350, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (73, 13, 'M1Z08124', 'Shaverblade', '內視鏡磨鑽', 1, 34200, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (74, 14, 'M1M05201', NULL, '多尼爾醫用鈥雷射(硬式都要簽)', 1, 5330, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (75, 15, 'M1M00528', NULL, '甫笙一次性電子軟式輸尿管鏡', 1, 80960, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (76, 15, 'M1M05204', NULL, '軟式輸尿管鏡(啟動力)', 1, 121000, '(共15萬七千)');
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (77, 15, 'M1M00524', NULL, '威德一次性使用輸尿管導引鞘(康成)', 1, 35400, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (78, 15, 'M1M01303', NULL, '波士頓科技斯若緹取石網', 1, 6563, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (79, 16, 'M1A01701', 'LEGIS ENDO-BAG5*7', '大吉士檢體袋', 1, 1020, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (80, 16, 'M1A86012', 'ATK', '(攜回)(500ML)鵬傷口清潔抗菌液', 1, 3055, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (81, 16, 'M1A80635', 'Exofin Topical', '百麗愛麗敷皮膚黏膠 1g', 1, 1430, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (82, 16, 'M1W60609', NULL, '柯惠索尼西超音波刀', 1, 37840, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (83, 16, 'M1Z00420', 'SURGIFLO', '斯爾弗止血劑(8ML)', 1, 22978, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (84, 16, 'M1W60607', NULL, '★#HAR9F愛惜康哈默尼克福克斯器械(9CM)', 1, 26330, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (85, 16, 'M1M21607', NULL, '★喉返神經監測器(美敦力泛特肌電圖用氣管內管)', 1, 22375, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (86, 16, 'M1M21905', NULL, '★球狀探針', 1, 5600, '(顧問用)');
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (87, 16, 'M1G02417', NULL, '4.史達美克史達射頻電極-甲狀腺', 1, 34650, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (88, 16, 'M1M21910', NULL, '★因諾美神經監測儀及其配件-喉返神經電極監測組+喉管電極貼片+單極探頭+皮下針電極INOMED C2 NERVEMONITOR', 1, 27684, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (89, 16, 'M1N25306', NULL, '★瀚醫生技防粘連可吸收膠HANBIO BARRIGEL#5ML(濃度40MG/ML)', 1, 8650, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (90, 16, 'M1X 55022', NULL, '★柯惠利嘉修爾艾賽克含塗層分離器COVIDIEN LIGASURE', 1, 32945, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (91, 17, 'M1M25931', NULL, '美敦力霹克電漿手術刀-PlasmaBlade 3.0S#PS210-030S(可伸縮扁平型)', 1, 18550, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (92, 17, 'M1Z00424', NULL, '百歐瑟宜莫斯加強型止血及防沾黏粉-5克BioCer HaemoCer PLUS haemostatic powder-5g', 1, 25400, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (93, 17, 'M1A80623', NULL, '易德鎂組織黏膠劑INDERMIL FLEXIFUZE TOPICAL TISSUE ADHESIVE#CM001(0.75ML/AMP)', 1, 3480, '*2');
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (94, 18, 'M1M25931', NULL, '美敦力霹克電漿手術刀-PlasmaBlade 3.0S#PS210-030S(可伸縮扁平型)', 1, 18550, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (95, 18, 'M1Z00424', NULL, '百歐瑟宜莫斯加強型止血及防沾黏粉-5克BioCer HaemoCer PLUS haemostatic powder-5g', 1, 25400, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (96, 18, 'M1A80623', NULL, '易德鎂組織黏膠劑INDERMIL FLEXIFUZE TOPICAL TISSUE ADHESIVE#CM001(0.75ML/AMP)', 1, 3480, NULL);
INSERT INTO set_items (id, set_id, hospital_code, name_en, name_zh, quantity, price, notes) VALUES (97, 18, 'M1S01928', NULL, '癒立安膠原蛋白敷料HEALIAID COLLAGEN WOUND DRESSING#HA101030(100X100X3MM)', 1, 36808, NULL);