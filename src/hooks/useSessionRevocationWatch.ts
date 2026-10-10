"use client";

import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";

const POLL_MS = 60_000;

/** Ends this browser's session: server cookie, Firebase sign-in and the local store. */
export async function endSessionNow(message = "Your session was ended - please sign in again."): Promise<void> {
  toast({ variant: "destructive", title: message });
  try { await fetch("/api/auth/session", { method: "DELETE" }); } catch { /* best effort */ }
  try { await signOut(auth); } catch { /* best effort */ }
  useAuthStore.getState().logout();
}

// Signs this device out when the login was signed out everywhere (api/auth/session-check answers 401 SESSION_REVOKED):
// polled once a minute and whenever the tab becomes visible again. Mounted once, in the dashboard layout. Network errors
// and any other answer never sign anyone out.
export function useSessionRevocationWatch(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/auth/session-check", { cache: "no-store" });
        if (res.status !== 401) return;
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        if (body.code === "SESSION_REVOKED" && !stopped) {
          stopped = true;
          await endSessionNow("Your login details were changed - please sign in again.");
        }
      } catch { /* offline / transient - try again next time */ }
    }
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled]);
}
