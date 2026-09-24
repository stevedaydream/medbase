import { callGas, clientIp, json } from "./_lib/gas.js";
import { signToken } from "./_lib/token.js";

/**
 * POST /api/login  { his, password } → { ok, token, user }
 * 以通訊錄的 HIS 帳號＋HIS 密碼登入（ADR-013）。鎖定與 IP 限制由 GAS 處理，
 * 錯誤訊息一律不透露帳號是否存在。
 */
export async function POST(request: Request): Promise<Response> {
  let body: { his?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return json({ ok: false, error: "格式錯誤" }, { status: 400 }); }
  const his = String(body.his ?? "").trim();
  const password = String(body.password ?? "");
  if (!his || !password || his.length > 64 || password.length > 128) {
    return json({ ok: false, error: "帳號或密碼錯誤" }, { status: 401 });
  }

  try {
    const r = await callGas({ action: "mobileLogin", his, password, ip: clientIp(request) });
    if (!r.ok && r.code === "UNAUTHORIZED") {
      console.error("[login] GAS 拒絕金鑰，請檢查 Vercel 環境變數 GAS_API_KEY");
      return json({ ok: false, error: "伺服器設定錯誤，請聯絡管理者" }, { status: 502 });
    }
    if (!r.ok) {
      const status = r.code === "LOCKED" ? 429 : 401;
      return json({ ok: false, code: r.code, error: r.error ?? "帳號或密碼錯誤" }, { status });
    }
    const user = r.user as { his: string; name: string; personId: string; role: string };
    const token = await signToken({ his: user.his, name: user.name, fp: String(r.fp) });
    return json({ ok: true, token, user });
  } catch (e) {
    console.error("[login]", e);
    return json({ ok: false, error: "伺服器暫時無法連線，請稍後再試" }, { status: 502 });
  }
}
