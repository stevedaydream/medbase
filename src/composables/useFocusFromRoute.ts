import { watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";

/**
 * 全域搜尋點結果後直接選中那一筆（ADR-024）：網址帶 ?focus=<key>:<id>。
 * 資料載入後呼叫 select；找到就移除 focus 參數，並把 [data-focus-id] 捲到可見位置。
 * key 用來區分同一頁（例如套組管理）的不同分頁，避免數字 id 撞在一起。
 */
export function useFocusFromRoute<T>(
  key: string,
  list: () => T[],
  idOf: (x: T) => string | number,
  select: (x: T) => void | Promise<void>,
) {
  const route = useRoute();
  const router = useRouter();
  const prefix = `${key}:`;

  async function tryFocus() {
    const f = route.query.focus;
    if (typeof f !== "string" || !f.startsWith(prefix)) return;
    const id = f.slice(prefix.length);
    const hit = list().find(x => String(idOf(x)) === id);
    if (!hit) return;
    const { focus: _focus, ...rest } = route.query;
    await router.replace({ query: rest });
    await select(hit);
    await nextTick();
    document.querySelector(`[data-focus-id="${CSS.escape(`${key}:${id}`)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  watch([() => route.query.focus, () => list().length], () => { void tryFocus(); }, { immediate: true });
}
