import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { CollegeType } from "@/types";

// Fetches the current session's college's `type` once - used to pick the
// right per-college-type designation/qualification lists (see
// src/lib/designations/config.ts) on Faculty/Supporting Staff/Vacancy
// Request forms. `undefined` while loading and for colleges with no type set
// (older records) - callers pass that straight through to the config
// helpers, which fall back to the Engineering-default lists for either case.
export function useCollegeType() {
  const [collegeType, setCollegeType] = useState<CollegeType | undefined>(undefined);
  const collegeId = useAuthStore((s) => s.user?.collegeId);
  const [loading, setLoading] = useState(Boolean(collegeId));

  useEffect(() => {
    if (!collegeId) return;
    let cancelled = false;
    fetch("/api/college/info")
      .then((r) => r.json() as Promise<{ type?: CollegeType }>)
      .then((d) => {
        if (!cancelled) setCollegeType(d.type);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collegeId]);

  return { collegeType, loading };
}
