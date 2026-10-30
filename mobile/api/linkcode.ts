import { json } from "./_lib/gas.js";
import { verifyToken } from "./_lib/token.js";
import { signLinkCode, LINK_TTL_MS } from "./_lib/linkCode.js";

/**
 * POST /api/linkcode  （Authorization: Bearer <手機登入憑證>）→ { ok, code, lineUrl, expiresIn }
 *
 * 綁定醫院群組助手 LINE bot：已登入的使用者取得 10 分鐘有效的綁定碼，
 * lineUrl 會開啟與 bot 的聊天並預填「綁定 <碼>」，送出後 bot 以 /api/bot 的 redeem 兌換。
 * 綁定過程不經手 HIS 密碼。
 */

const BOT_BASIC_ID = "@270auclk";

export async function POST(request: Request): Promise<Response> {
  const user = await verifyToken((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!user) return json({ ok: false, code: "AUTH", error: "登入已失效，請重新登入" }, { status: 401 });
  try {
    const code = await signLinkCode(user.his);
    const lineUrl = `https://line.me/R/oaMessage/${encodeURIComponent(BOT_BASIC_ID)}/?${encodeURIComponent(`綁定 ${code}`)}`;
    return json({ ok: true, code, lineUrl, expiresIn: LINK_TTL_MS / 1000 });
  } catch (e) {
    console.error("[linkcode]", e);
    return json({ ok: false, error: "伺服器設定錯誤，請聯絡管理者" }, { status: 500 });
  }
}
