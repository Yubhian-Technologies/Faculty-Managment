import crypto from "crypto";

interface FirebaseTokenPayload {
  uid: string;
  sub: string;
  email?: string;
  exp: number;
  iat: number;
  aud: string;
  iss: string;
  [key: string]: unknown;
}

let cachedKeys: Record<string, string> = {};
let cacheExpiry = 0;

async function getFirebasePublicKeys(): Promise<Record<string, string>> {
  if (Date.now() < cacheExpiry && Object.keys(cachedKeys).length > 0) {
    return cachedKeys;
  }

  const res = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
  );

  // Respect Cache-Control max-age from Google
  const cc = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = cc.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cacheExpiry = Date.now() + maxAge * 1000;

  cachedKeys = (await res.json()) as Record<string, string>;
  return cachedKeys;
}

function base64urlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export async function verifyFirebaseToken(token: string): Promise<FirebaseTokenPayload> {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Missing Firebase project ID");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64urlDecode(headerB64)) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new Error("Unsupported algorithm");
  if (!header.kid) throw new Error("Missing key ID");

  const keys = await getFirebasePublicKeys();
  const publicKey = keys[header.kid];
  if (!publicKey) throw new Error("Unknown key ID — token may be from a different project");

  // Verify RS256 signature using Node's native crypto
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const signatureBuffer = Buffer.from(
    signatureB64.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  );
  const valid = verifier.verify(publicKey, signatureBuffer);
  if (!valid) throw new Error("Invalid token signature");

  const payload = JSON.parse(base64urlDecode(payloadB64)) as FirebaseTokenPayload;
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp < now) throw new Error("Token has expired");
  if (payload.iat > now + 300) throw new Error("Token issued in the future");
  if (payload.aud !== projectId) throw new Error(`Invalid audience: ${payload.aud}`);
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  payload.uid = payload.sub;
  return payload;
}
