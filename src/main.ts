import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import App from "./App.vue";
import "./style.css";
import { useLogger } from "./composables/useLogger";
import { installGasKeyInjector } from "./composables/gasKeyInjector";
import { useCloudSettings } from "./stores/cloudSettings";

useLogger().initLogger();

const pinia = createPinia();
// 每個 GAS 請求自動附上金鑰（ADR-013）；金鑰於 App 掛載時由 cloudSettings.load() 讀入
installGasKeyInjector(() => useCloudSettings(pinia).gasApiKey);

createApp(App).use(pinia).use(router).mount("#app");
