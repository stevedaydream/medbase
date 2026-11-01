/** 圈字母／圈數字先做相容字正規化，再移除獨立圓圈，保留真正的代號。 */
export function normalizeDutySymbols(text: string): string {
  return text.normalize("NFKC").replace(/[○◯〇●◎⊙◉\u20dd]/g, "")
    .replace(/[．。]/g, ".").replace(/／/g, "/");
}

/** Word 用 EQ 疊字公式畫出的圈字母，實際字母藏在欄位指令中。 */
export function dutyEquationCode(instruction: string): string | null {
  return instruction.match(/\bEQ\s+\\o\s*\\ac\s*\(\s*[○◯〇●◎⊙◉]\s*[,，]\s*([a-z]|\d{1,2})\s*\)/i)?.[1].toLowerCase() ?? null;
}
