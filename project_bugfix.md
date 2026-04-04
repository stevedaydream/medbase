# MedBase — Bug Fix 紀錄

---

## BF-001 Sidebar 拖曳排序無法作動

**日期：** 2026-04-04
**狀態：** ✅ 已解決

### 問題描述

側邊欄 nav item 拖曳排序功能無法正常運作，出現以下症狀：
- 拖曳時游標顯示禁止符號（🚫），無法插入到目標位置
- 有透明度變化（代表 `dragstart` 有觸發），但 `drop` 無法完成

### 嘗試過程

**第一次（失敗）**
- 使用 HTML5 Drag & Drop API（`draggable="true"` + `dragover` / `drop` 事件）
- `RouterLink`（`<a>` 標籤）自帶 drag 行為干擾事件
- `dragleave` 因子元素觸發而誤清 `dragOver` 狀態

**第二次（失敗）**
- 在 `RouterLink` 加上 `draggable="false"`
- 改用 `@dragover.prevent` / `@drop.prevent` 修飾詞
- 修正 `onDragLeave` 使用 `relatedTarget` 判斷
- 仍然無效：Tauri WebView 對 HTML5 DnD API 支援不完整，`drop` 事件在 WebView 內無法可靠觸發

**第三次（成功）**
- 完全放棄 HTML5 Drag & Drop API
- 改為 Pointer Events（`pointerdown` / `pointermove` / `pointerup`）

### 根本原因

**Tauri v2 的 WebView（WRY）對 HTML5 Drag & Drop API 支援不完整**，`dragover.preventDefault()` 無法正確告知瀏覽器接受 drop，導致永遠顯示禁止游標且 `drop` 事件不觸發。

### 最終解決方案

使用 **Pointer Events** 實作拖曳排序，完全繞開 HTML5 DnD API。

**關鍵邏輯：**
1. `pointerdown` → 記錄起始 index，在 `document` 層級掛載 `pointermove` / `pointerup`
2. `pointermove` → 更新 ghost 元素位置；用 `querySelectorAll('[data-nav-index]')` + `getBoundingClientRect()` 判斷目前懸停的目標 index
3. `pointerup` → 若有移動則執行 splice 排序並存 `localStorage`；若未移動則視為點擊執行 `router.push()`
4. Ghost 元素用 `<Teleport to="body">` 掛到 body，固定定位跟隨游標

**自動區分點擊 vs 拖曳：** `isDragging` 在 `pointermove` 觸發後才設為 `true`，`pointerup` 依此判斷行為。

### 牽扯檔案與函式

| 檔案 | 函式 / 區塊 |
|------|------------|
| `src/components/layout/Sidebar.vue` | `onItemPointerDown()` |
| `src/components/layout/Sidebar.vue` | `onDocPointerMove()` |
| `src/components/layout/Sidebar.vue` | `onDocPointerUp()` |
| `src/components/layout/Sidebar.vue` | template `[data-nav-index]` 屬性 |
| `src/components/layout/Sidebar.vue` | `<Teleport to="body">` ghost 元素 |

---
