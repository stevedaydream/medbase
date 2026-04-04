import { createRouter, createWebHistory } from "vue-router";

declare module "vue-router" {
  interface RouteMeta { title?: string; fullHeight?: boolean }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/medications" },
    { path: "/medications", component: () => import("@/views/MedicationsView.vue"), meta: { title: "藥物字典" } },
    { path: "/prescriptions", component: () => import("@/views/PrescriptionsView.vue"), meta: { title: "處方套組" } },
    { path: "/surgery", component: () => import("@/views/SurgeryView.vue"), meta: { title: "手術處置" } },
    { path: "/disease", component: () => import("@/views/DiseaseView.vue"), meta: { title: "疾病常規" } },
    { path: "/examination", component: () => import("@/views/ExaminationView.vue"), meta: { title: "檢查處置" } },
    { path: "/emergency", component: () => import("@/views/EmergencyView.vue"), meta: { title: "危急情境" } },
    { path: "/items", component: () => import("@/views/ItemsView.vue"), meta: { title: "自費品項" } },
    { path: "/physicians", component: () => import("@/views/PhysiciansView.vue"), meta: { title: "醫師通訊錄" } },
    { path: "/sets",  component: () => import("@/views/SetsView.vue"),      meta: { title: "套組管理" } },
    { path: "/data",  component: () => import("@/views/DataManageView.vue"), meta: { title: "資料管理" } },
    { path: "/acp",   component: () => import("@/views/AcpView.vue"),        meta: { title: "ACP 評估" } },
    { path: "/acp/settings", component: () => import("@/views/AcpSettingsView.vue"), meta: { title: "ACP 設定" } },
    { path: "/ahk",      component: () => import("@/views/AhkView.vue"),       meta: { title: "AHK 管理",  fullHeight: true } },
    { path: "/schedule", component: () => import("@/views/SchedulerView.vue"), meta: { title: "排班表",    fullHeight: true } },
    { path: "/tools",    component: () => import("@/views/ToolsView.vue"),     meta: { title: "臨床工具",  fullHeight: true } },
  ],
});

export default router;
