/**
 * 伺服器端呼叫 GAS：網址與金鑰只存在 Vercel 環境變數（GAS_URL、GAS_API_KEY），手機端看不到。
 */
export interface GasResponse {
  ok: boolean;
  code?: string;
  error?: string;
  [k: string]: unknown;
}

export async function callGas(body: Record<string, unknown>): Promise<GasResponse> {
  const url = process.env.GAS_URL;
  const key = process.env.GAS_API_KEY;
  if (!url || !key) throw new Error("GAS_URL / GAS_API_KEY 未設定");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...body, api_key: key }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GAS HTTP ${res.status}`);
  return (await res.json()) as GasResponse;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** 取得用戶端 IP（Vercel 會附 x-forwarded-for / x-real-ip） */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
