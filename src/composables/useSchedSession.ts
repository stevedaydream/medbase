/**
 * 排班 v3 登入工作階段。第四階段改為通訊錄 HIS 帳密登入；
 * 在此之前以 super 身分開放（與舊排班頁開發模式相同）。
 */
import { reactive, readonly } from "vue";
import type { Role } from "@/utils/sched/types";

const state = reactive({
  personId: null as string | null,
  his: "",
  name: "",
  role: "super" as Role,
});

export function useSchedSession() {
  return readonly(state);
}
