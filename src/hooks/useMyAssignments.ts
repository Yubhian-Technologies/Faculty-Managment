import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// The delegated duties the signed-in login holds (see api/college/faculty/
// my-assignments). Fetched once per login and remembered for a few minutes in
// sessionStorage, so reloads and tab switches don't repeat the request. `null`
// means "not known yet" - callers keep tabs visible rather than flash them away.

export interface MyAssignments { timetableIncharge: boolean; sectionIncharge: boolean; midPaperSetter: boolean }

const TTL_MS = 5 * 60 * 1000;
const key = (uid: string) => `fms-my-assignments:${uid}`;

function readCache(uid: string): MyAssignments | null {
  try {
    const raw = sessionStorage.getItem(key(uid));
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: MyAssignments };
    return Date.now() - at < TTL_MS ? value : null;
  } catch { return null; }
}

export function useMyAssignments(enabled: boolean): MyAssignments | null {
  const uid = useAuthStore((s) => s.user?.uid);
  const [value, setValue] = useState<MyAssignments | null>(null);

  useEffect(() => {
    if (!enabled || !uid) return;
    const cached = readCache(uid);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached) { setValue(cached); return; }
    let cancelled = false;
    fetch("/api/college/faculty/my-assignments", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MyAssignments>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        setValue(d);
        try { sessionStorage.setItem(key(uid), JSON.stringify({ at: Date.now(), value: d })); } catch { /* private mode */ }
      })
      // Can't tell -> show everything rather than lock a real assignee out.
      .catch(() => { if (!cancelled) setValue({ timetableIncharge: true, sectionIncharge: true, midPaperSetter: true }); });
    return () => { cancelled = true; };
  }, [enabled, uid]);

  return enabled ? value : null;
}
