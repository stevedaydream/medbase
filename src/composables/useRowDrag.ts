import { ref, onUnmounted, type Ref } from "vue";

/**
 * 表格列拖曳排序（Pointer Events，BF-001：Tauri 不用 HTML5 DnD）。
 * 列加上 `data-drag-row="<id>"`，把手 `@pointerdown="onGripDown($event, id)"`；
 * 放開時呼叫 onDrop(id, beforeId)，beforeId 為 null 表示放到最後。
 * 靠近捲動容器上下邊緣時自動捲動。
 */
export function useRowDrag(deps: {
  scroller: Ref<HTMLElement | null>;
  enabled: () => boolean;
  onDrop: (id: string, beforeId: string | null) => void;
}) {
  const dragId = ref<string | null>(null);
  /** 放下的位置：插在這一列之前 */
  const dropBefore = ref<string | null>(null);
  const dropAtEnd = ref(false);
  let lastY = 0;
  let scrollTimer: ReturnType<typeof setInterval> | null = null;

  function updateDrop() {
    const rows = [...(deps.scroller.value ?? document).querySelectorAll<HTMLElement>("[data-drag-row]")];
    dropBefore.value = null;
    dropAtEnd.value = true;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (lastY < r.top + r.height / 2) { dropBefore.value = row.dataset.dragRow ?? null; dropAtEnd.value = false; break; }
    }
  }

  function onMove(e: PointerEvent) {
    lastY = e.clientY;
    updateDrop();
  }

  function stop() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onEnd);
    document.removeEventListener("pointercancel", onEnd);
    if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
  }

  function onEnd() {
    stop();
    const id = dragId.value, before = dropBefore.value, atEnd = dropAtEnd.value;
    dragId.value = null;
    dropBefore.value = null;
    dropAtEnd.value = false;
    if (!id || (!before && !atEnd) || before === id) return;
    deps.onDrop(id, before);
  }

  function onGripDown(e: PointerEvent, id: string) {
    if (e.button !== 0 || !deps.enabled()) return;
    e.preventDefault();
    dragId.value = id;
    dropBefore.value = null;
    dropAtEnd.value = false;
    lastY = e.clientY;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
    scrollTimer = setInterval(() => {
      const el = deps.scroller.value;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (lastY < r.top + 40) el.scrollTop -= 12;
      else if (lastY > r.bottom - 40) el.scrollTop += 12;
      else return;
      updateDrop();
    }, 30);
  }

  onUnmounted(stop);

  return { dragId, dropBefore, dropAtEnd, onGripDown };
}

/** 依拖曳結果移動陣列元素（就地修改）；回傳是否有變動 */
export function moveById<T>(list: T[], idOf: (x: T) => string, id: string, beforeId: string | null): boolean {
  const from = list.findIndex(x => idOf(x) === id);
  if (from < 0) return false;
  const [item] = list.splice(from, 1);
  const to = beforeId ? list.findIndex(x => idOf(x) === beforeId) : list.length;
  list.splice(to < 0 ? list.length : to, 0, item);
  return list.indexOf(item) !== from;
}
