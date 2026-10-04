import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// The HOD modules a Department Office head's HOD has allowed them (see api/
// college/department-office/access). `hrefs` is null when nothing was ever
// configured (no restriction). Only fetched for an office head. If the request
// fails the sidebar stays unrestricted rather than locking them out - the HOD's
// own choice is a convenience layer, not the security boundary.
export function useOfficeAllowedHrefs(enabled: boolean): { hrefs: string[] | null; loading: boolean } {
  const uid = useAuthStore((s) => s.user?.uid);
  const [state, setState] = useState<{ hrefs: string[] | null; done: boolean }>({ hrefs: null, done: false });

  useEffect(() => {
    if (!enabled || !uid) return;
    let cancelled = false;
    fetch("/api/college/department-office/access", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ hrefs: string[] | null }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setState({ hrefs: d.hrefs ?? null, done: true }); })
      .catch(() => { if (!cancelled) setState({ hrefs: null, done: true }); });
    return () => { cancelled = true; };
  }, [enabled, uid]);

  return { hrefs: enabled ? state.hrefs : null, loading: enabled && !state.done };
}
