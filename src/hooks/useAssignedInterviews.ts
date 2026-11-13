import { useHiringBatchesList } from "@/hooks/useHiringBatchesList";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@/types";

// Mirrors requireCollegeMember's allow-list on /api/college/hiring-batches -
// every other role (Super Admin, location-scoped roles, Webmaster, and any
// other college role never granted panel access) would 401. Kept as an
// allow-list rather than growing a deny-list, so a new role added there
// doesn't need a matching edit here too.
const HIRING_BATCH_ROLES: ReadonlySet<UserRole> = new Set([
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "HOD",
  "COLLEGE_OFFICE",
  "PANEL_MEMBER",
  "ACCOUNTS",
]);

export function useAssignedInterviews() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const enabled = !!role && HIRING_BATCH_ROLES.has(role);
  // PANEL_MEMBER is already filtered server-side by their uid; all other
  // roles need the asPanelMember flag to see batches they've been added to.
  const url = role === "PANEL_MEMBER" ? "/api/college/hiring-batches" : "/api/college/hiring-batches?asPanelMember=true";
  const { data, isLoading } = useHiringBatchesList(url, user?.uid, enabled);
  const batches = enabled ? data ?? [] : [];
  // For non-PANEL_MEMBER roles only show the nav when scoring is open
  const count = role === "PANEL_MEMBER"
    ? batches.length
    : batches.filter((b) => b.currentPhase === "PANEL_INTERVIEW" || b.currentPhase === "PRINCIPAL_FINAL_REVIEW").length;
  return { hasInterviews: count > 0, interviewCount: count, loading: enabled && isLoading };
}
