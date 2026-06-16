import crypto from "crypto";

interface FirebaseTokenPayload {
  uid: string;
  sub: string;
  user_id?: string;
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
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
    { cache: "no-store" }
  );

  if (!res.ok) throw new Error(`Failed to fetch Firebase public keys: ${res.status}`);

  const cc = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = cc.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cacheExpiry = Date.now() + maxAge * 1000;

  cachedKeys = (await res.json()) as Record<string, string>;
  return cachedKeys;
}

function b64urlDecode(str: string): Buffer {
  // Pad to multiple of 4
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function verifyFirebaseToken(token: string): Promise<FirebaseTokenPayload> {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    "";

  if (!projectId) throw new Error("Missing Firebase project ID env var");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT: expected 3 parts");

  const [headerB64, payloadB64, sigB64] = parts;

  // Decode header
  const header = JSON.parse(b64urlDecode(headerB64).toString("utf8")) as {
    kid?: string;
    alg?: string;
  };

  if (header.alg !== "RS256") throw new Error(`Unsupported algorithm: ${header.alg}`);
  if (!header.kid) throw new Error("JWT header missing kid");

  // Fetch Google's public keys (PEM-encoded X.509 certs)
  const keys = await getFirebasePublicKeys();
  const publicKeyPem = keys[header.kid];
  if (!publicKeyPem) {
    throw new Error(`No public key for kid=${header.kid}. Keys available: ${Object.keys(keys).join(", ")}`);
  }

  // Verify RS256 signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureBuffer = b64urlDecode(sigB64);

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingInput, "ascii");
  const valid = verifier.verify(publicKeyPem, signatureBuffer);
  if (!valid) throw new Error("JWT signature verification failed");

  // Decode payload
  const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as FirebaseTokenPayload;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
  if (payload.iat > now + 300) throw new Error("Token iat is in the future");
  if (payload.aud !== projectId) throw new Error(`Token aud "${payload.aud}" does not match project "${projectId}"`);
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`Invalid token issuer: ${payload.iss}`);
  }

  // Normalise uid — Firebase uses both sub and user_id
  payload.uid = payload.user_id ?? payload.sub;
  return payload;
}
