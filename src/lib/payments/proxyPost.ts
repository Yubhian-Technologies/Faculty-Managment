import http from "http";
import https from "https";
import tls from "tls";

// POSTs a form to an HTTPS URL through the static-IP proxy (PAYMENT_PROXY_URL, e.g. a QuotaGuard
// Static URL "http://user:pass@host:port") with an HTTP CONNECT tunnel - so the call leaves from
// the proxy's fixed IP, which CCAvenue has whitelisted. ONLY the CCAvenue API calls use this; the rest of
// the app goes out as usual. Without the variable it refuses (CCAvenue would reject a direct call).

export const paymentProxyConfigured = () => !!process.env.PAYMENT_PROXY_URL;

export async function proxyPostForm(url: string, form: Record<string, string>, timeoutMs = 20_000): Promise<{ status: number; body: string }> {
  const proxyRaw = process.env.PAYMENT_PROXY_URL;
  if (!proxyRaw) throw new Error("PAYMENT_PROXY_NOT_CONFIGURED");
  const proxy = new URL(proxyRaw);
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("HTTPS_ONLY");
  const payload = new URLSearchParams(form).toString();
  const auth = proxy.username ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` : undefined;
  const port = Number(target.port || 443);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { connect.destroy(new Error("PAYMENT_PROXY_TIMEOUT")); }, timeoutMs);
    const connect = http.request({
      host: proxy.hostname, port: Number(proxy.port || 80), method: "CONNECT", path: `${target.hostname}:${port}`,
      headers: { Host: `${target.hostname}:${port}`, ...(auth ? { "Proxy-Authorization": auth } : {}) },
    });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { clearTimeout(timer); socket.destroy(); reject(new Error(`PAYMENT_PROXY_CONNECT_${res.statusCode}`)); return; }
      // TLS to CCAvenue inside the tunnel (the proxy only sees encrypted bytes); certificate checked as usual.
      const req = https.request({
        host: target.hostname, port, method: "POST", path: `${target.pathname}${target.search}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload), Host: target.hostname },
        agent: false,
        createConnection: () => tls.connect({ socket, servername: target.hostname }),
      }, (r) => {
        let body = "";
        r.setEncoding("utf8");
        r.on("data", (c: string) => { body += c; if (body.length > 1_000_000) r.destroy(new Error("RESPONSE_TOO_LARGE")); });
        r.on("end", () => { clearTimeout(timer); resolve({ status: r.statusCode ?? 0, body }); });
        r.on("error", (e) => { clearTimeout(timer); reject(e); });
      });
      req.on("error", (e) => { clearTimeout(timer); reject(e); });
      req.end(payload);
    });
    connect.on("error", (e) => { clearTimeout(timer); reject(e); });
    connect.end();
  });
}
