import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from "@simplewebauthn/server";

// Self check-in with a passkey (Phase 1): the person registers THIS phone once; each check-in / check-out is then
// one tap + the phone's own fingerprint / face unlock. The server verifies a signature made by the key that never
// leaves the phone - something a script or a replayed request can't produce (the face path only gets a descriptor
// the browser computed). It proves "this person's registered phone, unlocked by its owner", not which finger -
// the campus location check still applies.
//
// colleges/{c}/passkeys/{credentialId}   { uid, publicKey (base64url), counter, transports, label, createdAt, lastUsedAt }
// colleges/{c}/passkeyChallenges/{uid}  { challenge, purpose, expiresAt } - one open challenge per person, used once
// colleges/{c}/settings/selfCheckIn      { method: FACE | PASSKEY | EITHER } (missing = FACE: nothing changes)

export type SelfCheckInMethod = "FACE" | "PASSKEY" | "EITHER";
export const SELF_CHECK_IN_METHODS: SelfCheckInMethod[] = ["FACE", "PASSKEY", "EITHER"];
// One phone per person. Changing it is not self-service: the HOD / Principal resets the check-in registration
// (removeAllPasskeys) and the person registers the new phone once - so nobody can quietly move their check-in
// onto a colleague's phone.
export const MAX_PASSKEYS_PER_PERSON = 1;
export const CHANGE_REGISTRATION_MESSAGE = "To change it, ask your HOD to reset your check-in registration (the Principal for an HOD).";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type Db = FirebaseFirestore.Firestore;
const college = (db: Db, c: string) => db.collection("colleges").doc(c);

export class PasskeyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function allowsFace(m: SelfCheckInMethod): boolean { return m === "FACE" || m === "EITHER"; }
export function allowsPasskey(m: SelfCheckInMethod): boolean { return m === "PASSKEY" || m === "EITHER"; }

export async function selfCheckInMethod(db: Db, c: string): Promise<SelfCheckInMethod> {
  const snap = await college(db, c).collection("settings").doc("selfCheckIn").get();
  const m = (snap.data() as { method?: string } | undefined)?.method;
  return SELF_CHECK_IN_METHODS.includes(m as SelfCheckInMethod) ? (m as SelfCheckInMethod) : "FACE";
}

/** The site the passkey belongs to, from the request (localhost, a preview or the live domain). */
export function relyingParty(request: Request): { rpID: string; origin: string } {
  const h = request.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host).split(",")[0].trim();
  const hostname = host.replace(/:\d+$/, "");
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
  return { rpID: hostname, origin: `${proto}://${host}` };
}

export interface StoredPasskey {
  uid: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  label: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
}

async function myPasskeys(db: Db, c: string, uid: string) {
  const snap = await college(db, c).collection("passkeys").where("uid", "==", uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as StoredPasskey) }));
}

export async function listPasskeys(db: Db, c: string, uid: string) {
  const toIso = (v: unknown) => (v && typeof (v as { toDate?: () => Date }).toDate === "function" ? (v as { toDate: () => Date }).toDate().toISOString() : null);
  return (await myPasskeys(db, c, uid)).map((p) => ({ id: p.id, label: p.label, createdAt: toIso(p.createdAt), lastUsedAt: toIso(p.lastUsedAt) }));
}

async function saveChallenge(db: Db, c: string, uid: string, challenge: string, purpose: string) {
  await college(db, c).collection("passkeyChallenges").doc(uid).set({ challenge, purpose, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
}

/** The open challenge for `purpose`, removed in the same step so it can be used once only. */
async function takeChallenge(db: Db, c: string, uid: string, purpose: string): Promise<string> {
  const ref = college(db, c).collection("passkeyChallenges").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as { challenge?: string; purpose?: string; expiresAt?: { toDate: () => Date } } | undefined;
    if (!d?.challenge || d.purpose !== purpose) throw new PasskeyError("Start again - the request was not found.", 409);
    tx.delete(ref);
    if ((d.expiresAt?.toDate().getTime() ?? 0) < Date.now()) throw new PasskeyError("That took too long - try again.", 409);
    return d.challenge;
  });
}

export async function registrationOptions(db: Db, c: string, uid: string, userName: string, request: Request) {
  const existing = await myPasskeys(db, c, uid);
  if (existing.length >= MAX_PASSKEYS_PER_PERSON) {
    throw new PasskeyError(`Your phone is already registered. ${CHANGE_REGISTRATION_MESSAGE}`, 409);
  }
  const { rpID } = relyingParty(request);
  const options = await generateRegistrationOptions({
    rpName: "Vishnu People",
    rpID,
    userName: userName || uid,
    userID: new TextEncoder().encode(uid),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as never })),
    // The phone's own screen lock (fingerprint / face / PIN), not a separate security key.
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
    preferredAuthenticatorType: "localDevice",
  });
  await saveChallenge(db, c, uid, options.challenge, "REGISTER");
  return options;
}

export async function verifyRegistration(db: Db, c: string, uid: string, response: RegistrationResponseJSON, label: string, request: Request) {
  const expectedChallenge = await takeChallenge(db, c, uid, "REGISTER");
  const { rpID, origin } = relyingParty(request);
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch (err) {
    console.warn("[passkeys] registration not verified", err);
    throw new PasskeyError("This phone could not be registered. Try again.");
  }
  if (!result.verified || !result.registrationInfo) throw new PasskeyError("This phone could not be registered. Try again.");
  const { credential } = result.registrationInfo;
  if ((await myPasskeys(db, c, uid)).length >= MAX_PASSKEYS_PER_PERSON) {
    throw new PasskeyError(`Your phone is already registered. ${CHANGE_REGISTRATION_MESSAGE}`, 409);
  }
  const doc: StoredPasskey = {
    uid,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    ...(credential.transports?.length ? { transports: credential.transports } : {}),
    label: label.trim().slice(0, 60) || "My phone",
    createdAt: new Date(),
    lastUsedAt: null,
  };
  await college(db, c).collection("passkeys").doc(credential.id).set(doc);
  return { id: credential.id, label: doc.label };
}

/** Removes every passkey of a person (an HOD / Principal resetting their check-in registration). */
export async function removeAllPasskeys(db: Db, c: string, uid: string): Promise<number> {
  const snap = await college(db, c).collection("passkeys").where("uid", "==", uid).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
  return snap.size;
}

export async function authenticationOptions(db: Db, c: string, uid: string, request: Request) {
  const mine = await myPasskeys(db, c, uid);
  if (!mine.length) throw new PasskeyError("Register this phone first.", 409);
  const { rpID } = relyingParty(request);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: mine.map((p) => ({ id: p.id, transports: p.transports as never })),
    userVerification: "required",
  });
  await saveChallenge(db, c, uid, options.challenge, "ATTENDANCE");
  return options;
}

/** Verifies a passkey signature made for an attendance check-in / check-out. Returns the passkey used. */
export async function verifyAttendancePasskey(db: Db, c: string, uid: string, response: AuthenticationResponseJSON, request: Request): Promise<{ credentialId: string; label: string; registeredAt: Date | null }> {
  const ref = college(db, c).collection("passkeys").doc(response.id);
  const snap = await ref.get();
  const stored = snap.data() as StoredPasskey | undefined;
  if (!stored || stored.uid !== uid) throw new PasskeyError("This phone is not registered for your check-in. Register it first.", 403);
  const expectedChallenge = await takeChallenge(db, c, uid, "ATTENDANCE");
  const { rpID, origin } = relyingParty(request);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: response.id, publicKey: isoBase64URL.toBuffer(stored.publicKey), counter: stored.counter, transports: stored.transports },
    });
  } catch (err) {
    console.warn("[passkeys] attendance signature not verified", err);
    throw new PasskeyError("Your phone's fingerprint / face unlock could not be verified. Try again.", 403);
  }
  if (!result.verified) throw new PasskeyError("Your phone's fingerprint / face unlock could not be verified. Try again.", 403);
  await ref.update({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() });
  const created = stored.createdAt as unknown as { toDate?: () => Date } | Date | undefined;
  const registeredAt = created instanceof Date ? created : created?.toDate?.() ?? null;
  return { credentialId: response.id, label: stored.label, registeredAt };
}
