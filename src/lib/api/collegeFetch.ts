import { useAuthStore } from "@/store/authStore";

// Global roles (FINANCE, PURCHASE_DEPT) have no collegeId in their session, so
// every /api/college/* route falls back to a `?collegeId=` query param (see
// requireCollegeContext in src/lib/auth/verifySession.ts). College-scoped roles
// already carry a fixed session.collegeId, which the server prefers over this
// param, so appending it here is harmless for them too.
export function withCollegeId(path: string): string {
  const collegeId = useAuthStore.getState().selectedCollegeId;
  if (!collegeId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}collegeId=${encodeURIComponent(collegeId)}`;
}

export function collegeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(withCollegeId(path), init);
}
