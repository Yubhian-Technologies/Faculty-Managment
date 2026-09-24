"use client";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// Check once if the logged-in user is Timetable Incharge for any course/year.
// PANEL_MEMBER / COLLEGE_STAFF get the nav item only when this is true;
// HOD/PRINCIPAL always see their own timetable nav, so this hook is only
// consumed for those two roles.
export function useIsTimetableIncharge(): { isIncharge: boolean | null; isLoading: boolean } {
  const user = useAuthStore((s) => s.user);
  const [isIncharge, setIsIncharge] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsIncharge(null);
      return;
    }
    // Only faculty / technical staff can ever be incharge; others never need the check.
    if (user.role !== "PANEL_MEMBER" && user.role !== "COLLEGE_STAFF") {
      setIsIncharge(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetch("/api/college/timetable-incharges?mine=true")
      .then((r) => r.json() as Promise<{ incharges?: unknown[] }>)
      .then((j) => {
        if (cancelled) return;
        setIsIncharge((j.incharges?.length ?? 0) > 0);
      })
      .catch(() => {
        if (!cancelled) setIsIncharge(false);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.uid, user?.role]);

  return { isIncharge, isLoading };
}
