import { createHmac, timingSafeEqual } from "crypto";

// Short-lived, signed student ids for the HOD Students list.
//
// The HOD roster is scoped by rules a single document read can't re-check
// cheaply (which departments, which years, primary vs cross-listed - see
// hodPagedList.ts, which needs the whole department and course lists to decide).
// So the list request does that work ONCE and hands the client every matching id
// - each signed. Asking for a later page then sends back just that page's signed
// ids, and the server only has to verify the signatures and read exactly those
// documents; it never has to repeat the scoping, and a forged or foreign id
// (one this HOD wasn't given, in this role, for this college) fails the check.
//
// Bound to (college, user, view) and an expiry, so an id can't be replayed by
// another user, against another college, in another view (the editable roster vs
// the read-only incoming list), or after the HOD's scope has had time to change.
//
// Secret: SESSION_SECRET if set, else the Firebase admin private key - the same
// choice sessionToken.ts makes for the session cookie (see its comment).

const TTL_MS = 2 * 60 * 60 * 1000;

function secret(): string {
  const key = process.env.SESSION_SECRET ?? process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("SESSION_SECRET (or FIREBASE_ADMIN_PRIVATE_KEY) is not set");
  return key;
}

function sign(binding: string, id: string, expiresAt: number): string {
  return createHmac("sha256", secret()).update(`${binding}|${id}|${expiresAt}`).digest("base64url").slice(0, 22);
}

/** `<id>.<expiresAt>.<signature>` */
export function signStudentId(binding: string, id: string, now = Date.now()): string {
  const expiresAt = now + TTL_MS;
  return `${id}.${expiresAt}.${sign(binding, id, expiresAt)}`;
}

/** The id if the token is genuine, unexpired and issued for `binding`; else null. */
export function verifySignedStudentId(binding: string, token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expiresAt = Number(exp);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  const expected = Buffer.from(sign(binding, id, expiresAt));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return id;
}
