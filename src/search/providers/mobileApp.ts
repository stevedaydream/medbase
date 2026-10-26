import type { SearchProvider } from "../types";

/** 手機版安裝 QR code：入口本身（側欄彈窗） */
export default {
  key: "mobile-app",
  tables: [],
  async load() {
    return [{
      type: "功能", label: "手機版 QR code", sub: "掃描後依 Android / iPhone 引導安裝 PWA",
      keywords: "手機 手機版 行動版 QR QRcode 掃描 安裝 PWA iPhone Android 主畫面", route: "/sets?show=mobile-qr",
    }];
  },
} satisfies SearchProvider;
