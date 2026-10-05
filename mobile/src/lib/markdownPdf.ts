import { renderMarkdown } from '@shared/markdown/render'
import { DOC_CSS } from '@shared/markdown/export/settings'
import katexCss from 'katex/dist/katex.min.css?inline'

/** 相對路徑圖片無法從單一 .md 檔讀取，以替代文字顯示。 */
export const markdownImage = (src: string) => /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src) ? src : ''

/** 每頁獨立繪製，避免長文件超過手機 canvas 尺寸上限。 */
export async function markdownPdf(source: string, title: string, progress: (page: number) => void): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:680px;height:1000px;border:0;pointer-events:none'
  document.body.appendChild(frame)
  try {
    const doc = frame.contentDocument!
    doc.open()
    doc.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"></head><body></body></html>')
    doc.close()
    const style = doc.createElement('style')
    style.textContent = `${DOC_CSS}\n${katexCss}\nhtml { font-size:16px; } body { display:flow-root; width:680px; max-width:none; padding:0; margin:0; font-family:Arial,"Microsoft JhengHei","PingFang TC",sans-serif; line-height:1.6; overflow-wrap:anywhere; } ul { list-style:disc; } ol { list-style:decimal; } table { max-width:100%; table-layout:fixed; width:100%; } th, td { overflow-wrap:anywhere; } pre { overflow:visible; white-space:pre-wrap; } h1,h2,h3,h4,h5,h6 { margin-top:0.8em; } img { max-height:950px; }`
    doc.head.appendChild(style)
    doc.body.innerHTML = renderMarkdown(source, { image: markdownImage }).html
    // 先觸發排版，讓公式字型開始載入，再等字型完成後計算分頁。
    void doc.body.offsetHeight
    await doc.fonts.ready
    await Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => undefined)))
    const width = 680
    const pageHeight = Math.floor(width * 267 / 180)
    let total = 0
    const boxes: { top: number; bottom: number }[] = []
    let breaks: number[] = []
    // html2canvas 複製文件後可能改變公式／表單的高度，必須以複製後的版面計算分頁。
    const probe = await html2canvas(doc.body, {
      width, height: 1, scale: 1, windowWidth: width, windowHeight: 1000,
      scrollX: 0, scrollY: 0, logging: false, useCORS: true,
      onclone: cloned => {
        total = cloned.body.scrollHeight
        const walker = cloned.createTreeWalker(cloned.body, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue
          const range = cloned.createRange()
          range.selectNodeContents(walker.currentNode)
          for (const r of Array.from(range.getClientRects())) boxes.push({ top: r.top - 1, bottom: r.bottom + 4 })
        }
        for (const el of cloned.querySelectorAll('p, pre, blockquote, li, h1, h2, h3, h4, h5, h6, tr, img, .md-math')) {
          const r = el.getBoundingClientRect()
          if (r.height < pageHeight) boxes.push({ top: r.top, bottom: r.bottom })
        }
        breaks = Array.from(cloned.querySelectorAll('.md-pagebreak')).map(el => el.getBoundingClientRect().top)
      },
    })
    probe.width = probe.height = 0
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    pdf.setProperties({ title })
    let start = 0, page = 0
    do {
      let end = Math.min(total, start + pageHeight)
      const manual = breaks.find(y => y > start + 1 && y < end)
      if (manual !== undefined) end = manual
      if (end < total) {
        let safe = end
        for (let i = 0; i < 20; i++) {
          const crossing = boxes.filter(b => b.top < safe && b.bottom > safe + 0.5 && b.top > start + 1)
          if (!crossing.length) break
          safe = Math.floor(Math.min(...crossing.map(b => b.top)))
        }
        if (safe > start + 1) end = safe
      }
      const height = Math.max(1, end - start)
      progress(++page)
      const canvas = await html2canvas(doc.body, {
        backgroundColor: '#ffffff', scale: 1.5, useCORS: true,
        x: 0, y: start, width, height, windowWidth: width, windowHeight: 1000,
        scrollX: 0, scrollY: 0, logging: false,
      })
      if (page > 1) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 15, 15, 180, height * 180 / width)
      canvas.width = canvas.height = 0
      start = end
    } while (start < total)
    return pdf.output('blob')
  } finally { frame.remove() }
}
