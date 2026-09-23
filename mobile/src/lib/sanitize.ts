/**
 * 規則備忘錄內容為桌機 Tiptap 的 HTML；手機顯示前以白名單過濾，
 * 只留排版用標籤，移除 script、事件屬性與 javascript: 連結。
 */
const ALLOWED = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'SPAN', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
])

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement | null
  if (!root) return ''
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED.has(child.tagName)) {
        // 不允許的標籤：保留文字內容，丟掉標籤本身（script/style 連內容一起丟）
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(child.tagName)) child.remove()
        else { walk(child); child.replaceWith(...Array.from(child.childNodes)) }
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const keep = child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:|tel:)/i.test(attr.value.trim())
        if (!keep) child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer') }
      walk(child)
    }
  }
  walk(root)
  return root.innerHTML
}
