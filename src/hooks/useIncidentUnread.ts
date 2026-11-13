"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

// The sidebar's "Incident Record" items, one per receiving dashboard.
export const INCIDENT_RECORD_HREFS = [
  "/principal/incident-record",
  "/academics/incident-record",
  "/hod/incident-record",
];

// Fired by the Incident Record page once a report is opened, so the sidebar
// dot clears straight away instead of on the next navigation.
export const INCIDENT_VIEWED_EVENT = "incident-records-viewed";

const RECEIVING_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS", "HOD"];

// How many incident reports the signed-in Principal / Vice Principal / Dean
// Academics / HOD has not opened yet. 0 for every other login.
export function useIncidentUnread(): number {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const queryClient = useQueryClient();
  // A seat holder (e.g. a College Admin working as Principal) keeps their own role as `role`;
  // the seats they hold are in `roles`.
  const eligible = !!user && [user.role, ...(user.roles ?? user.seatRoles ?? [])].some((r) => RECEIVING_ROLES.includes(r));
  const uid = user?.uid ?? "";

  // One shared query for the sidebar and the mobile drawer (each used to fetch on every navigation).
  const { data } = useQuery({
    queryKey: ["nav", "incidentUnread", uid],
    queryFn: async () => {
      const r = await fetch("/api/college/incident-reports/inbox?count=1");
      if (!r.ok) return 0;
      const json = (await r.json()) as { unreadCount?: number };
      return json.unreadCount ?? 0;
    },
    enabled: eligible,
    staleTime: 30_000,
  });

  // Moving to another page re-checks only once the count is 30 s old; opening a report re-checks at once.
  useEffect(() => {
    if (!eligible) return;
    void queryClient.refetchQueries({ queryKey: ["nav", "incidentUnread", uid], stale: true });
  }, [eligible, pathname, uid, queryClient]);
  useEffect(() => {
    if (!eligible) return;
    const reload = () => { void queryClient.invalidateQueries({ queryKey: ["nav", "incidentUnread", uid] }); };
    window.addEventListener(INCIDENT_VIEWED_EVENT, reload);
    return () => window.removeEventListener(INCIDENT_VIEWED_EVENT, reload);
  }, [eligible, uid, queryClient]);

  return eligible ? data ?? 0 : 0;
}
