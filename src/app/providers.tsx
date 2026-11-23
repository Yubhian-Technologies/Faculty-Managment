"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { NotificationDrawer } from "@/components/notifications/NotificationDrawer";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef, type ReactNode } from "react";
import { useAuthStore } from "@/store/authStore";
import { useWorkContextStore } from "@/store/workContextStore";
import { registerServiceWorker } from "@/lib/attendance/offlinePage";

function AuthInitializer({ children }: { children: ReactNode }) {
  useAuth();
  useClearCacheOnIdentityChange();
  // Lets Mark Attendance open with no internet (public/sw.js); nothing else is changed by it.
  useEffect(() => { registerServiceWorker(); }, []);
  return <>{children}</>;
}

/**
 * Cached screen data (dashboards, lists) belongs to whoever loaded it. When another person signs in in the same tab,
 * or the same person switches "Working as" (another department / role), drop it all - the next screen loads that
 * person's own data instead of showing the previous one's until its cache runs out.
 */
function useClearCacheOnIdentityChange() {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const context = useWorkContextStore((s) => (uid ? s.chosen[uid] ?? "" : ""));
  const last = useRef<string | null>(null);
  useEffect(() => {
    // The first identity after the page loads is the baseline; only a later change clears. Signing out clears too
    // (and remembers that it did), so the next person starts clean.
    const key = uid ? `${uid}|${context}` : last.current ? "signed-out" : null;
    if (last.current && key && key !== last.current) queryClient.clear();
    if (key) last.current = key;
  }, [uid, context]);
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer>
        {children}
        <NotificationDrawer />
        <Toaster />
      </AuthInitializer>
    </QueryClientProvider>
  );
}
