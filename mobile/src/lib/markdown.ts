import MarkdownIt from 'markdown-it'
import { isLegacyHtml } from '@shared/markdown/format'
import { sanitizeHtml } from './sanitize'

/**
 * 規則備忘錄內容轉成可顯示的 HTML：新版是 Markdown，舊版是 Tiptap HTML。
 * 原文中的 HTML 不直接輸出（html: false），結果一律再經過 sanitizeHtml。
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

// 待辦清單「- [ ] / - [x]」：改成核取符號（sanitize 不允許 input）
md.core.ruler.after('inline', 'task-list', state => {
  for (const tok of state.tokens) {
    if (tok.type !== 'inline' || !tok.children?.length) continue
    const first = tok.children[0]
    if (first.type !== 'text') continue
    const m = /^\[( |x|X)\]\s+/.exec(first.content)
    if (m) first.content = (m[1] === ' ' ? '☐ ' : '☑ ') + first.content.slice(m[0].length)
  }
})

export function renderMemo(content: string): string {
  if (!content) return ''
  return sanitizeHtml(isLegacyHtml(content) ? content : md.render(content))
}

/** 搜尋與摘要用的純文字（不含 Markdown 符號與 HTML 標籤） */
export function memoPlainText(content: string): string {
  if (!content) return ''
  const html = isLegacyHtml(content) ? content : md.render(content)
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
}
