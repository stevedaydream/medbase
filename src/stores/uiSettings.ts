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

export const useUiSettings = defineStore("uiSettings", () => {
  const fontSize = ref<FontSize>(
    (localStorage.getItem("ui-font-size") as FontSize | null) ?? "md"
  );

  function applyFontSize() {
    document.documentElement.style.fontSize = SIZE_PX[fontSize.value];
  }

  watch(fontSize, () => {
    localStorage.setItem("ui-font-size", fontSize.value);
    applyFontSize();
  });

  function load() {
    applyFontSize();
  }

  return { fontSize, load };
});
