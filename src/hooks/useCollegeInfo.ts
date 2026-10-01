import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { CollegeType } from "@/types";

export interface CollegeInfo {
  name?: string;
  code?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  email?: string;
  type?: CollegeType;
  logoUrl?: string;
}

export function useCollegeInfo() {
  const [collegeInfo, setCollegeInfo] = useState<CollegeInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const collegeId = useAuthStore((s) => s.user?.collegeId);
  const [loading, setLoading] = useState(Boolean(collegeId));

  useEffect(() => {
    if (!collegeId) return;
    let cancelled = false;
    fetch("/api/college/info")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CollegeInfo) => {
        if (cancelled) return;
        if (d && typeof d === "object" && !("error" in d)) {
          setCollegeInfo(d);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collegeId]);

  return { collegeInfo, loading, failed };
}
