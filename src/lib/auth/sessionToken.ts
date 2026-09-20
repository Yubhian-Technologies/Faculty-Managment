// Signing for the `fms-session` cookie. The cookie carries the person's role(s)
// and is read by proxy.ts (edge) and verifySession (node) - so without a
// signature anyone could edit it in their browser and claim any role. Uses Web
// Crypto (HMAC-SHA256), which both runtimes have.
//
// Secret: SESSION_SECRET if set, else derived from the Firebase admin private
// key, which is server-only and already required - so this works without any
// new configuration.

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!s) throw new Error("SESSION_SECRET (or FIREBASE_ADMIN_PRIVATE_KEY) is not set");
  return s;
}

function toB64Url(bytes: ArrayBuffer): string {
  let bin = "";
  new Uint8Array(bytes).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toB64Url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function utf8ToB64(json: string): string {
  let bin = "";
  enc.encode(json).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// `v1.<payload>.<signature>`
export async function signSession(payload: object): Promise<string> {
  const body = utf8ToB64(JSON.stringify(payload));
  return `v1.${body}.${await hmac(`v1.${body}`)}`;
}

// The payload if the signature is valid, else null. Cookies from before signing
// existed (`header.<payload>.signature`) fail here, so those sessions simply
// sign in again.
export async function readSession<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [version, body, sig] = token.split(".");
  if (version !== "v1" || !body || !sig) return null;
  try {
    const expected = await hmac(`v1.${body}`);
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return null;
    return JSON.parse(b64ToUtf8(body)) as T;
  } catch {
    return null;
  }
}
