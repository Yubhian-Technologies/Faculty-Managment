"use client";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// Whether the logged-in user may author/publish college Circulars.
//
// Mirrors the server-side gate (lib/circular/permissions.ts canSendCircular):
// PRINCIPAL/VICE_PRINCIPAL (incl. COLLEGE_ADMIN/DIRECTOR, whose session role is
// normalized to PRINCIPAL) always can; everyone else only when the Principal
// has granted their uid or role in colleges/{id}/settings/circularPermissions.
// Used purely for UI niceness (hiding the Circulars tab and the compose form) -
// the API routes remain the real gate and still return 403 without it.
//
// Resolution result is cached per uid for the session (module-level promise)
// because Sidebar, MobileDrawer and the circulars pages all need the same
// answer on every dashboard. A failed check resolves to false so the tab
// fails closed - the API's own guard is what a user with real access hits
// if they type the URL by hand and the request glitched.
//
// null = still resolving (callers keep the tab visible while loading, same
// convention as useIsTimetableIncharge, to avoid flicker for people who do
// have access).
const canSendCache = new Map<string, Promise<boolean>>();

function fetchCanSend(uid: string): Promise<boolean> {
  const existing = canSendCache.get(uid);
  if (existing) return existing;
  const p = fetch("/api/college/circulars/permissions/me", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ canSend?: boolean }>) : { canSend: false }))
    .then((d) => d.canSend === true)
    .catch(() => false);
  canSendCache.set(uid, p);
  return p;
}

export function useCanSendCirculars(): { canSend: boolean | null } {
  const user = useAuthStore((s) => s.user);
  const [canSend, setCanSend] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.uid || !user?.collegeId) return;
    let cancelled = false;
    fetchCanSend(user.uid).then((ok) => {
      if (!cancelled) setCanSend(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.collegeId]);

  return { canSend };
}
