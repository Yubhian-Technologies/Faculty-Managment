import { useAuthStore } from "@/store/authStore";

/**
 * True for a RESIGNED/RETIRED faculty member (FMSUser.readOnlyAccess, derived server-side from
 * facultyMembers.status). Screens use it to hide every control that would change something; the API
 * guards deny the write regardless, so this only keeps the page honest.
 */
export function useReadOnlyAccess(): boolean {
  return useAuthStore((s) => s.user?.readOnlyAccess === true);
}
