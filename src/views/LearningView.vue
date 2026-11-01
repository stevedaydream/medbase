<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "@/shared/markdown/render";
import { COMPLAINTS, LEARNING_DOCUMENTS, LEARNING_ENTRIES, filterLearningEntries,
  learningAsset, learningNotice, learningEntryForAnchor, headingId, type LearningEntry } from "@/shared/learning";

const route = useRoute();
const router = useRouter();
const queryValue = (key: string) => typeof route.query[key] === "string" ? route.query[key] as string : "";
function filter(change: Record<string, string>) {
  void router.replace({ path: "/learning", query: { ...route.query, entry: undefined, ...change } });
}
const query = computed({ get: () => queryValue("q"), set: q => filter({ q }) });
const complaint = computed(() => queryValue("complaint"));
const kind = computed(() => queryValue("kind") || (queryValue("entry").startsWith("document-") ? "document" : "all"));
const visible = computed(() => filterLearningEntries(query.value, complaint.value, kind.value));
const selected = computed(() => visible.value.find(e => e.id === queryValue("entry")) ?? visible.value[0]);
const source = computed(() => LEARNING_DOCUMENTS.find(d => d.id === selected.value?.documentId));
const kindLabel = (entry: LearningEntry) => entry.kind === "original" ? "原表轉寫" : entry.kind === "reading" ? "診斷延伸閱讀" : "完整文件";
const complaintLabel = (id: string) => COMPLAINTS.find(c => c.id === id)?.label ?? id;
const modes = [{ id: "all", label: "全部條目" }, { id: "original", label: "主訴原表" },
  { id: "reading", label: "診斷延伸" }, { id: "document", label: "完整文件" }];
const originalCount = LEARNING_ENTRIES.filter(e => e.kind === "original").length;
const readingCount = LEARNING_ENTRIES.filter(e => e.kind === "reading").length;
const article = ref<HTMLElement | null>(null);
const entryList = ref<HTMLElement | null>(null);
const notice = computed(() => renderMarkdown(learningNotice(selected.value?.documentId ?? ""), { math: "mathml" }).html);
const asset = (path: string) => learningAsset(path, import.meta.env.BASE_URL);
const html = computed(() => renderMarkdown((selected.value?.markdown ?? "").replace(/\*\*OSCE 重點：\*\*/g, "**OSCE 重點**："), { image: asset, math: "mathml" }).html
  .replace(/<img /g, '<img loading="lazy" decoding="async" '));
const originalDocument = LEARNING_DOCUMENTS.find(d => d.id === "original")!;
const pages = [...originalDocument.markdown.matchAll(/^### PDF 第 (\d+) 頁：(.+)\r?$/gm)]
  .map(m => ({ page: Number(m[1]), complaint: headingId(m[2]), path: `assets/原始第${m[1].padStart(2, "0")}頁.png` }));
const originalPages = computed(() => selected.value?.kind === "original"
  ? pages.filter(p => selected.value!.complaints.includes(p.complaint)) : []);
function select(entry: LearningEntry) {
  void router.push({ path: "/learning", query: { ...route.query, entry: entry.id } });
}
function fullDocument() {
  void router.push({ path: "/learning", query: { kind: "document", entry: `document-${selected.value?.documentId}` } });
}
watch(() => selected.value?.id, async () => {
  await nextTick();
  article.value?.scrollTo({ top: 0 });
  entryList.value?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
}, { immediate: true });

const imageDialog = ref<HTMLDialogElement | null>(null);
const imagePreview = ref<{ src: string; alt: string } | null>(null);
async function showImage(src: string, alt: string) {
  imagePreview.value = { src, alt };
  await nextTick();
  imageDialog.value?.showModal();
}
async function followContentLink(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const image = target?.closest("img");
  if (image) { await showImage(image.getAttribute("src") ?? "", image.getAttribute("alt") ?? "原始掃描"); return; }
  const link = target?.closest("a");
  if (!link) return;
  const href = link.getAttribute("href") ?? "";
  event.preventDefault();
  if (href.startsWith("#")) {
    const entry = learningEntryForAnchor(href, selected.value?.documentId ?? "");
    if (entry) {
      await router.push({ path: "/learning", query: { kind: "reading", entry: entry.id } });
    } else {
      const id = decodeURIComponent(href.slice(1));
      [...(article.value?.querySelectorAll<HTMLElement>("[id]") ?? [])].find(el => el.id === id)?.scrollIntoView({ block: "start" });
    }
  } else if (asset(href)) {
    await showImage(asset(href), link.textContent ?? "原始掃描");
  } else if (/^https?:\/\//i.test(href)) {
    if (isTauri()) await openUrl(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }
}
</script>

<template>
  <div class="accent-cyan h-full flex flex-col bg-sunken text-fg overflow-hidden">
    <header class="px-6 pt-5 pb-4 border-b border-hairline shrink-0 space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs font-bold text-accent tracking-widest mb-1">新進人員 · OSCE</p>
          <h2 class="text-2xl font-bold tracking-tight">學習資源</h2>
          <p class="text-xs text-muted mt-1.5">從主訴找問診與檢查線索，再延伸閱讀診斷與來源。</p>
        </div>
        <div class="flex gap-5 text-xs text-muted pt-1">
          <span><strong class="block text-xl font-bold text-fg tabular-nums">{{ COMPLAINTS.length }}</strong>大主訴</span>
          <span><strong class="block text-xl font-bold text-fg tabular-nums">{{ originalCount }}</strong>原表條目</span>
          <span><strong class="block text-xl font-bold text-fg tabular-nums">{{ readingCount }}</strong>延伸閱讀</span>
        </div>
      </div>
      <nav class="flex flex-wrap gap-1.5" aria-label="依主訴篩選">
        <button @click="filter({ complaint: '' })" :aria-pressed="!complaint"
          class="topic" :class="!complaint ? 'active' : ''">全部主訴</button>
        <button v-for="c in COMPLAINTS" :key="c.id" @click="filter({ complaint: c.id })"
          class="topic" :class="complaint === c.id ? 'active' : ''" :aria-pressed="complaint === c.id">{{ c.label }}</button>
      </nav>
    </header>

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <aside class="w-64 xl:w-80 shrink-0 border-r border-hairline flex flex-col bg-surface/40">
        <div class="p-4 pb-3 space-y-3 border-b border-hairline">
          <div class="relative">
            <input v-model="query" aria-label="搜尋學習資源" placeholder="搜尋診斷、問診或檢查…"
              type="search" class="w-full px-3 py-2.5 rounded-xl bg-sunken border border-hairline text-sm outline-none focus:border-accent" />
          </div>
          <div class="grid grid-cols-2 gap-1" role="group" aria-label="資源類型">
            <button v-for="mode in modes" :key="mode.id" @click="filter({ kind: mode.id })" :aria-pressed="kind === mode.id"
              class="text-xs py-2 rounded-lg transition-colors" :class="kind === mode.id ? 'text-accent bg-accent/10 font-bold' : 'text-muted hover:text-fg'">{{ mode.label }}</button>
          </div>
          <p class="text-xs text-muted" role="status">{{ visible.length }} 個結果<span v-if="complaint"> · {{ complaintLabel(complaint) }}</span></p>
        </div>
        <div ref="entryList" class="flex-1 overflow-y-auto p-2 space-y-1" aria-label="學習條目">
          <button v-for="entry in visible" :key="entry.id" @click="select(entry)"
            :aria-current="selected?.id === entry.id ? 'true' : undefined"
            class="w-full text-left rounded-xl px-3 py-3 border transition-colors"
            :class="selected?.id === entry.id ? 'bg-accent/10 border-accent/25' : 'border-transparent hover:bg-elevated'">
            <span class="text-2xs font-bold" :class="entry.kind === 'reading' ? 'text-accent' : 'text-muted'">{{ kindLabel(entry) }}</span>
            <span class="block text-sm font-bold mt-1 leading-snug">{{ entry.title }}</span>
            <span class="block text-xs text-muted mt-1.5 line-clamp-2 leading-relaxed">{{ entry.excerpt }}</span>
          </button>
          <div v-if="!visible.length" class="p-5 text-sm text-muted leading-relaxed">
            沒有符合的條目。可縮短關鍵字，或清除主訴與類型篩選。
            <button class="block text-accent mt-3" @click="filter({ q: '', complaint: '', kind: 'all' })">清除篩選</button>
          </div>
        </div>
      </aside>

      <main ref="article" class="flex-1 min-w-0 overflow-y-auto px-6 lg:px-9 py-6">
        <div v-if="selected" class="max-w-4xl mx-auto pb-12">
          <div class="flex flex-wrap items-center gap-2 text-xs mb-3">
            <span class="px-2 py-1 rounded-md bg-accent/10 text-accent font-bold">{{ kindLabel(selected) }}</span>
            <span v-for="id in selected.complaints" :key="id" class="text-muted">{{ complaintLabel(id) }}</span>
            <span v-if="selected.documentId === 'reading'" class="text-warning ml-auto">研究草稿 · 仍需臨床複核</span>
            <span v-else class="text-muted ml-auto">原表轉寫 · 非現行診療指引</span>
          </div>
          <h1 class="text-2xl font-bold leading-snug tracking-tight mb-4">{{ selected.title }}</h1>
          <details class="border border-hairline bg-surface rounded-xl p-3.5 mb-5">
            <summary class="text-xs text-muted cursor-pointer">來源與資料說明</summary>
            <p class="mt-3 text-xs text-muted break-all">{{ source?.sourceFile }}</p>
            <div class="learning-prose text-sm mt-2" v-html="notice" />
          </details>
          <div v-if="originalPages.length" class="flex flex-wrap gap-2 mb-5">
            <button v-for="page in originalPages" :key="page.page" @click="showImage(asset(page.path), `原始掃描第 ${page.page} 頁`)"
              class="text-xs text-accent border border-accent/20 px-3 py-2 rounded-lg hover:bg-accent/10">核對原圖 · 第 {{ page.page }} 頁</button>
          </div>
          <article class="learning-prose" @click="followContentLink" v-html="html" />
          <footer class="mt-8 pt-4 border-t border-hairline flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{{ source?.title }}</span>
            <button v-if="selected.kind !== 'document'" @click="fullDocument" class="text-accent hover:underline ml-auto">閱讀完整來源文件 →</button>
          </footer>
        </div>
        <div v-else class="h-full flex items-center justify-center text-muted text-sm">選擇其他主訴或關鍵字，開始查閱。</div>
      </main>
    </div>

    <dialog ref="imageDialog" @close="imagePreview = null" class="scan-dialog bg-surface text-fg border border-hairline rounded-2xl p-0">
      <div v-if="imagePreview">
        <div class="sticky top-0 bg-surface px-4 py-3 border-b border-hairline flex items-center justify-between gap-4">
          <h2 class="text-sm font-bold">{{ imagePreview.alt }}</h2>
          <button @click="imageDialog?.close()" aria-label="關閉原圖" class="px-3 py-1 rounded-lg hover:bg-elevated">✕</button>
        </div>
        <img :src="imagePreview.src" :alt="imagePreview.alt" class="block w-full h-auto" />
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.topic { padding: .4rem .85rem; border: 1px solid var(--color-hairline); border-radius: 999px; font-size: .75rem; color: var(--color-fg-secondary); cursor: pointer; transition: background .15s; }
.topic:hover, .topic.active { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 10%, transparent); border-color: color-mix(in srgb, var(--color-accent) 35%, transparent); }
.scan-dialog { max-width: min(95vw, 1100px); width: 95vw; max-height: 90vh; margin: auto; }
.scan-dialog::backdrop { background: rgb(0 0 0 / .65); }
.learning-prose { line-height: 1.9; font-size: .9375rem; overflow-wrap: anywhere; color: var(--color-fg-secondary); }
.learning-prose :deep(h1), .learning-prose :deep(h2), .learning-prose :deep(h3) { color: var(--color-fg); font-weight: 700; line-height: 1.5; margin: 1.8em 0 .7em; scroll-margin-top: 1rem; }
.learning-prose :deep(h1) { font-size: 1.6em; }
.learning-prose :deep(h2) { font-size: 1.3em; border-bottom: 1px solid var(--color-hairline); padding-bottom: .5em; }
.learning-prose :deep(h3) { font-size: 1em; color: var(--color-accent); }
.learning-prose :deep(p) { margin: .8em 0; }
.learning-prose :deep(strong) { color: var(--color-fg); font-weight: 700; }
.learning-prose :deep(a) { color: var(--color-accent); text-decoration: underline; text-underline-offset: 3px; }
.learning-prose :deep(ul), .learning-prose :deep(ol) { padding-left: 1.5em; margin: 1em 0; list-style: revert; }
.learning-prose :deep(blockquote) { border-left: 3px solid var(--color-accent); padding-left: 1em; margin: 1em 0; }
.learning-prose :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; width: 100%; margin: 1.5em 0; font-size: .85em; }
.learning-prose :deep(th), .learning-prose :deep(td) { border: 1px solid var(--color-hairline); padding: .7em .9em; min-width: 100px; vertical-align: top; }
.learning-prose :deep(th) { background: var(--color-surface); color: var(--color-fg); text-align: left; }
.learning-prose :deep(img) { max-width: 100%; height: auto; background: white; cursor: zoom-in; border-radius: .5rem; }
.learning-prose :deep(hr) { border: 0; border-top: 1px solid var(--color-hairline); margin: 2em 0; }
.learning-prose :deep(code) { font-size: .85em; background: var(--color-elevated); padding: .15em .35em; border-radius: .25rem; }
</style>
