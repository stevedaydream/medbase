/**
 * LINE 綁定碼（醫院群組助手 bot）：手機已登入的使用者取得一組短效碼，傳給 bot 後由 bot 兌換出 HIS 帳號。
 * 格式同登入憑證（base64url(payload).base64url(signature)），不需要資料庫；有效 10 分鐘。
 * 與登入憑證共用 TOKEN_SECRET，但簽章前加上用途字首，兩者不能互相冒用。
 */

export const LINK_TTL_MS = 10 * 60 * 1000;

interface LinkPayload {
  purpose: "line-link";
  his: string;
  exp: number;
}

const enc = new TextEncoder();
const PURPOSE = "line-link";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
}

async function hmac(data: string): Promise<Uint8Array> {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error("TOKEN_SECRET 未設定或太短（至少 32 字元）");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${PURPOSE}:${data}`)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signLinkCode(his: string, now = Date.now()): Promise<string> {
  const payload: LinkPayload = { purpose: PURPOSE, his, exp: now + LINK_TTL_MS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(body))}`;
}

/** 回傳綁定碼內的 HIS 帳號；簽章錯誤、過期或格式不符回傳 null */
export async function verifyLinkCode(code: string | null | undefined, now = Date.now()): Promise<string | null> {
  if (!code || code.length > 400) return null;
  const [body, sig] = code.trim().split(".");
  if (!body || !sig) return null;
  try {
    if (!timingSafeEqual(await hmac(body), fromB64url(sig))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as LinkPayload;
    if (p.purpose !== PURPOSE || typeof p.his !== "string" || !p.his || typeof p.exp !== "number" || p.exp < now) return null;
    return p.his;
  } catch {
    return null;
  }
}
