// Firebase Auth REST API helpers — no firebase-admin/auth required.
// Uses the Identity Toolkit REST endpoint so Vercel Lambdas never need
// to import the firebase-admin/auth subpackage.

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
const BASE = "https://identitytoolkit.googleapis.com/v1";

type FirebaseRestError = { error?: { message?: string; code?: number } };

export async function createFirebaseUser(
  email: string,
  password: string,
  displayName: string
): Promise<string> {
  const res = await fetch(`${BASE}/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName, returnSecureToken: false }),
  });

  const data = (await res.json()) as { localId?: string } & FirebaseRestError;

  if (!res.ok || !data.localId) {
    const msg = data.error?.message ?? "USER_CREATE_FAILED";
    if (msg === "EMAIL_EXISTS") throw Object.assign(new Error(msg), { code: "auth/email-already-exists" });
    if (msg === "WEAK_PASSWORD : Password should be at least 6 characters" || msg.startsWith("WEAK_PASSWORD"))
      throw Object.assign(new Error("Password is too weak"), { code: "auth/weak-password" });
    throw Object.assign(new Error(msg), { code: "auth/create-failed" });
  }

  return data.localId;
}

export async function updateFirebaseUserEmail(
  uid: string,
  newEmail: string,
  idToken: string
): Promise<void> {
  const res = await fetch(`${BASE}/accounts:update?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, email: newEmail, returnSecureToken: false }),
  });
  if (!res.ok) {
    const data = (await res.json()) as FirebaseRestError;
    throw new Error(data.error?.message ?? "UPDATE_FAILED");
  }
}
