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

  useEffect(() => {
    fetch("/api/college/info")
      .then((r) => r.json() as Promise<CollegeInfo>)
      .then((d) => {
        if (d && typeof d === "object" && !("error" in d)) {
          setCollegeInfo(d);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { collegeInfo, loading };
}
