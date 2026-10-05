"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupportingStaffMember } from "@/types";

export interface OwnSupportingStaffState {
  /** The signed-in Supporting Staff member's own record; null when their login isn't linked to one. */
  staff: Partial<SupportingStaffMember> | null;
  loading: boolean;
  /** Why there is no record (login not linked / failed to load). */
  message: string | null;
  reload: () => Promise<void>;
}

/**
 * The Supporting Staff member's OWN supportingStaff record (GET /api/college/supporting-staff/me) - the source of
 * truth for everything on their My Profile pages. The login (users) is only a mirror of name and photo, which is why
 * a photo changed by their HOD used to show up there only after the cached login was refreshed.
 */
export function useOwnSupportingStaff(): OwnSupportingStaffState {
  const [staff, setStaff] = useState<Partial<SupportingStaffMember> | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const fetchOwn = useCallback(async () => {
    try {
      const res = await fetch("/api/college/supporting-staff/me", { cache: "no-store" });
      const data = (await res.json()) as { staff?: Partial<SupportingStaffMember> | null; message?: string; error?: string };
      if (!res.ok) {
        setStaff(null);
        setMessage(data.error ?? "Failed to load your profile");
        return;
      }
      setStaff(data.staff ?? null);
      setMessage(data.staff ? null : (data.message ?? "No staff record was found for your login."));
    } catch {
      setStaff(null);
      setMessage("Failed to load your profile");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchOwn();
      setLoading(false);
    })();
  }, [fetchOwn]);

  return { staff, loading, message, reload: fetchOwn };
}
