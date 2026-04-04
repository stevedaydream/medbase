/**
 * 使用 Web Crypto API 計算 SHA-256 hex digest。
 * 在 Tauri WebView（Chromium）和現代瀏覽器中均可用。
 */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
