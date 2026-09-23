/**
 * 自動在每個 GAS 請求附上 api_key（ADR-013）。
 *
 * 桌機呼叫 GAS 的地方超過 40 處，都是 POST text/plain + JSON 字串 body。
 * 逐處加參數容易漏，改在 window.fetch 統一處理：只動送往 GAS Web App、
 * body 為 JSON 物件且尚未帶 api_key 的請求，其他請求原樣放行。
 */
const GAS_URL = /^https:\/\/script\.google(?:usercontent)?\.com\/macros\//;

export function installGasKeyInjector(getKey: () => string) {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = getKey();
    if (key && GAS_URL.test(url) && typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body && typeof body === "object" && !Array.isArray(body) && !("api_key" in body)) {
          init = { ...init, body: JSON.stringify({ ...body, api_key: key }) };
        }
      } catch { /* 非 JSON body，原樣送出 */ }
    }
    return origFetch(input, init);
  };
}
