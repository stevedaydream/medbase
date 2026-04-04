import { defineStore } from "pinia";
import { ref } from "vue";

export const useEmergencyStore = defineStore("emergency", () => {
  const isActive = ref(false);

  function activate() {
    isActive.value = true;
  }

  function deactivate() {
    isActive.value = false;
  }

  function toggle() {
    isActive.value = !isActive.value;
  }

  return { isActive, activate, deactivate, toggle };
});
