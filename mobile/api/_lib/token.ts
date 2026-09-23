/**
 * 手機登入憑證（ADR-013）：HMAC-SHA256 簽章的 JSON，不需要資料庫。
 * 格式：base64url(payload).base64url(signature)
 * 有效 30 天，每次成功使用由 /api/gas 換發新的（滑動延長）。
 * fp 為 HIS 密碼指紋，GAS 每次請求都比對，密碼一改舊憑證即失效。
 */

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPayload {
  his: string;
  name: string;
  staffCode: string;
  staffName: string;
  fp: string;
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmac(data: string): Promise<Uint8Array> {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error("TOKEN_SECRET 未設定或太短（至少 32 字元）");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signToken(p: Omit<TokenPayload, "exp">): Promise<string> {
  const payload: TokenPayload = { ...p, exp: Date.now() + TOKEN_TTL_MS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(body))}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyToken(token: string | null | undefined): Promise<TokenPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    if (!timingSafeEqual(await hmac(body), fromB64url(sig))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
