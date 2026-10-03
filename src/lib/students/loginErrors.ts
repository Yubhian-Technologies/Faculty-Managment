// Turns a failure from the Firebase Admin SDK (Auth or Firestore) into a
// message College Office can act on. Student-login routes used to answer a bare
// "Internal error" for every one of these, which made a misconfigured project
// (missing IAM role, Auth not enabled, quota) indistinguishable from a bug.
// Only a short, fixed explanation plus the SDK's error code is returned - never
// the raw message, which can carry project ids or key details.

export interface LoginFailure { message: string; status: number; code: string }

export function describeLoginFailure(err: unknown): LoginFailure {
  const e = err as { code?: string | number; errorInfo?: { code?: string }; message?: string } | null;
  const code = String(e?.errorInfo?.code ?? e?.code ?? "unknown");
  const text = `${code} ${e?.message ?? ""}`.toLowerCase();

  if (code === "auth/invalid-email" || code === "auth/invalid-uid") {
    return { code, status: 400, message: "This Roll Number can't be turned into a valid login ID - correct the Roll Number first" };
  }
  if (code === "auth/invalid-password") {
    return { code, status: 500, message: "The default student password is rejected by Firebase Authentication - contact support" };
  }
  if (code === "auth/insufficient-permission" || text.includes("insufficient permission") || code === "7" || text.includes("permission_denied")) {
    return { code, status: 500, message: "The server's Firebase service account isn't allowed to manage logins (needs the Firebase Authentication Admin role) - contact support" };
  }
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found" || text.includes("identity toolkit") || text.includes("identitytoolkit")) {
    return { code, status: 500, message: "Firebase Authentication (email/password sign-in) isn't enabled for this project - contact support" };
  }
  if (code === "8" || text.includes("resource_exhausted") || text.includes("quota") || code === "auth/quota-exceeded") {
    return { code, status: 503, message: "Firebase is rate- or quota-limited right now - wait a few minutes and try again" };
  }
  if (code === "auth/internal-error" || code === "14" || text.includes("unavailable") || text.includes("econn") || text.includes("etimedout")) {
    return { code, status: 503, message: "Couldn't reach Firebase - try again in a moment" };
  }
  return { code, status: 500, message: `Couldn't complete the login request (code: ${code})` };
}
