import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  // Set when the fetch failed outright (network error, or a 401 because this
  // login's role isn't on GET /api/college/info's allow-list). Previously this
  // was swallowed, so a caller falling back to "College" - a letterhead that
  // silently reads "College" instead of the institution's name - was
  // indistinguishable from a college that genuinely has no name saved yet.
  // Callers that render a fallback can now show it only once we've actually
  // failed, rather than flashing it during the initial load.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
  }, []);

  return { collegeInfo, loading, failed };
}
