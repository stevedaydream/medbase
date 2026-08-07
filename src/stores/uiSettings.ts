import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type FontSize = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<FontSize, string> = {
  sm: "16px",
  md: "18px",
  lg: "20px",
  xl: "22px",
};

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  sm: "小",
  md: "中",
  lg: "大",
  xl: "超大",
};

/** system = 跟隨 Windows 的深淺色設定（它本身已有日夜排程） */
export type Theme = "light" | "dark" | "system";

export const THEME_LABELS: Record<Theme, string> = {
  light: "淺色",
  dark: "深色",
  system: "跟隨系統",
};

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export const useUiSettings = defineStore("uiSettings", () => {
  const fontSize = ref<FontSize>(
    (localStorage.getItem("ui-font-size") as FontSize | null) ?? "md"
  );
  const theme = ref<Theme>(
    (localStorage.getItem("ui-theme") as Theme | null) ?? "system"
  );

  /** 目前實際套用的是不是深色（把 system 解析成具體值後的結果） */
  const resolvedDark = ref(false);

  function applyFontSize() {
    document.documentElement.style.fontSize = SIZE_PX[fontSize.value];
  }

  function applyTheme() {
    const dark = theme.value === "dark"
      || (theme.value === "system" && darkQuery.matches);
    resolvedDark.value = dark;
    // style.css 的 :root[data-theme="dark"] 只換 token 值，組件不需感知
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  watch(fontSize, () => {
    localStorage.setItem("ui-font-size", fontSize.value);
    applyFontSize();
  });

  watch(theme, () => {
    localStorage.setItem("ui-theme", theme.value);
    applyTheme();
  });

  // 使用者在 Windows 端切換深淺色時，system 模式要跟著變
  darkQuery.addEventListener("change", () => {
    if (theme.value === "system") applyTheme();
  });

  /** 快捷切換鈕用：在淺／深之間切，並固定下來（脫離 system） */
  function toggleTheme() {
    theme.value = resolvedDark.value ? "light" : "dark";
  }

  function load() {
    applyFontSize();
    applyTheme();
  }

  return { fontSize, theme, resolvedDark, toggleTheme, load };
});
