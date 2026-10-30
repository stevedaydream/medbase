/**
 * 通知醫院群組助手 LINE bot（換班申請／回覆）。bot 依 HIS 帳號找綁定的 LINE 帳號私訊。
 * 未設定 BOT_NOTIFY_URL／BOT_NOTIFY_SECRET 就不送；送不出去只記 log，絕不影響換班本身。
 * 簽章：HMAC-SHA256(`${timestamp}.${body}`)，bot 端拒絕 5 分鐘以外的時間戳。
 */

export interface BotNotice {
  event: "swap_request" | "swap_accepted" | "swap_rejected" | "swap_cancelled";
  toHis: string;
  text: string;
  ym: string;
}

const enc = new TextEncoder();
const TIMEOUT_MS = 2000;

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return Array.from(sig, b => b.toString(16).padStart(2, "0")).join("");
}

export async function notifyBot(notice: BotNotice): Promise<void> {
  const url = process.env.BOT_NOTIFY_URL;
  const secret = process.env.BOT_NOTIFY_SECRET;
  if (!url || !secret || !notice.toHis) return;
  try {
    const body = JSON.stringify(notice);
    const timestamp = String(Date.now());
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-medbase-timestamp": timestamp,
        "x-medbase-signature": await sign(secret, `${timestamp}.${body}`),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[botNotify] ${notice.event} -> HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[botNotify] ${notice.event} failed:`, e instanceof Error ? e.message : e);
  }
}
