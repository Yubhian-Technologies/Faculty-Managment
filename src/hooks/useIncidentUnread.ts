"use client";

import { useEffect, useState } from "react";
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
  const [count, setCount] = useState(0);
  // A seat holder (e.g. a College Admin working as Principal) keeps their own role as `role`;
  // the seats they hold are in `roles`.
  const eligible = !!user && [user.role, ...(user.roles ?? user.seatRoles ?? [])].some((r) => RECEIVING_ROLES.includes(r));

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const load = () => {
      fetch("/api/college/incident-reports/inbox?count=1")
        .then((r) => (r.ok ? (r.json() as Promise<{ unreadCount?: number }>) : null))
        .then((json) => { if (!cancelled && json) setCount(json.unreadCount ?? 0); })
        .catch(() => {});
    };
    load();
    window.addEventListener(INCIDENT_VIEWED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(INCIDENT_VIEWED_EVENT, load);
    };
  }, [eligible, pathname]);

  return eligible ? count : 0;
}
