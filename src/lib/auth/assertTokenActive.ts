import { getAdminAuth } from "@/lib/firebase/admin";

// verifyFirebaseToken checks the signature and claims only. For the few routes that accept a
// bearer token instead of the session cookie, also confirm the account has not since been
// disabled and the token was not issued before its refresh tokens were revoked (which is what
// deactivating or demoting someone does). One Admin call, on low-traffic routes only.
export async function assertTokenActive(uid: string, issuedAtSeconds: number | undefined): Promise<boolean> {
  try {
    const user = await (await getAdminAuth()).getUser(uid);
    if (user.disabled) return false;
    const validAfter = user.tokensValidAfterTime ? Math.floor(new Date(user.tokensValidAfterTime).getTime() / 1000) : 0;
    if (issuedAtSeconds !== undefined && validAfter > issuedAtSeconds) return false;
    return true;
  } catch {
    // Can't tell (Auth outage): fail closed for an authorisation question.
    return false;
  }
}
