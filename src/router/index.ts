import { createRouter, createWebHistory } from "vue-router";

declare module "vue-router" {
  interface RouteMeta { title?: string; fullHeight?: boolean }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/sets" },
    // 處方套組／手術處置／疾病常規／檢查處置已併入套組管理的分頁，保留舊網址轉址
    { path: "/prescriptions", redirect: { path: "/sets", query: { tab: "prescriptions" } } },
    { path: "/surgery",       redirect: { path: "/sets", query: { tab: "surgery" } } },
    { path: "/disease",       redirect: { path: "/sets", query: { tab: "disease" } } },
    { path: "/examination",   redirect: { path: "/sets", query: { tab: "examination" } } },
    { path: "/emergency", component: () => import("@/views/EmergencyView.vue"), meta: { title: "危急情境" } },
    { path: "/items", component: () => import("@/views/ItemsView.vue"), meta: { title: "自費品項" } },
    { path: "/physicians", component: () => import("@/views/PhysiciansView.vue"), meta: { title: "通訊錄" } },
    // 常用分機已併入通訊錄，保留舊網址轉址
    { path: "/contacts",   redirect: "/physicians" },
    { path: "/sets",  component: () => import("@/views/SetsHubView.vue"),   meta: { title: "套組管理" } },
    { path: "/data",  component: () => import("@/views/DataManageView.vue"), meta: { title: "資料管理" } },
    { path: "/acp",   component: () => import("@/views/AcpView.vue"),        meta: { title: "ACP 評估" } },
    { path: "/acp/settings", component: () => import("@/views/AcpSettingsView.vue"), meta: { title: "ACP 設定", fullHeight: true } },
    { path: "/ahk",      component: () => import("@/views/AhkView.vue"),       meta: { title: "AHK 管理",  fullHeight: true } },
    { path: "/schedule", component: () => import("@/views/SchedulerView.vue"), meta: { title: "排班表",    fullHeight: true } },
    { path: "/tools",        component: () => import("@/views/ToolsView.vue"),       meta: { title: "臨床工具",  fullHeight: true } },
    { path: "/shift-memos",  component: () => import("@/views/ShiftMemosView.vue"),  meta: { title: "規則備忘錄", fullHeight: true } },
    { path: "/settings",     component: () => import("@/views/SettingView.vue"),     meta: { title: "設定" } },
    { path: "/note-polish",  component: () => import("@/views/NotePolishView.vue"),  meta: { title: "病歷潤飾", fullHeight: true } },
    { path: "/research",     component: () => import("@/views/ResearchView.vue"),    meta: { title: "論文專案", fullHeight: true } },
    { path: "/research/:id", component: () => import("@/views/ResearchProjectView.vue"), meta: { title: "論文專案", fullHeight: true } },
  ],
});

export default router;
