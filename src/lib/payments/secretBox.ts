import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Keeps a payment secret (a college's CCAvenue Working Key) encrypted at rest in Firestore with
// AES-256-GCM, keyed by the PAYMENT_CONFIG_SECRET environment variable. Without that variable no
// key can be saved or used - online payment simply stays off.

function masterKey(): Buffer {
  const s = process.env.PAYMENT_CONFIG_SECRET ?? "";
  if (s.length < 32) throw new Error("PAYMENT_CONFIG_SECRET_MISSING");
  return createHash("sha256").update(s, "utf8").digest();
}

export const paymentSecretConfigured = () => (process.env.PAYMENT_CONFIG_SECRET ?? "").length >= 32;

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

export function openSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("BAD_SEALED_SECRET");
  const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
