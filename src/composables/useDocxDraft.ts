import { reactive, ref, toRefs } from "vue";
import { DOCX_TEMPLATES, type MetaValues, type BlockValues } from "@/shared/docxTemplates";
import type { SourceFile, TemplateKey } from "@/shared/docxCompose";

// 僅留在本次執行的記憶體中，跨路由與文件分頁保留，不將文件內容寫入儲存空間。
export const notePolishMode = ref<"chat" | TemplateKey>("chat");
export const chatDraft = reactive({
  chatMessages: [] as { role: "user" | "model"; text: string }[],
  chatInput: "",
  chatStreaming: false,
  streamingText: "",
});

function createDraft(template: TemplateKey) {
  const tpl = DOCX_TEMPLATES[template];
  return reactive({
    meta: Object.fromEntries(tpl.fields.map(f => [f.key, f.default ?? ""])) as MetaValues,
    blocks: Object.fromEntries(tpl.blocks.map(b => [b.key, ""])) as BlockValues,
    files: [] as SourceFile[],
    manualText: "",
    deidentify: template === "case",
    isGenerating: false,
  });
}

const drafts = { case: createDraft("case"), leave: createDraft("leave") };

export function useDocxDraft(template: TemplateKey) {
  const draft = drafts[template];
  return { ...toRefs(draft), meta: draft.meta, blocks: draft.blocks };
}
