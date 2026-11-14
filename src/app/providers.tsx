"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { NotificationDrawer } from "@/components/notifications/NotificationDrawer";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, type ReactNode } from "react";
import { registerServiceWorker } from "@/lib/attendance/offlinePage";

function AuthInitializer({ children }: { children: ReactNode }) {
  useAuth();
  // Lets Mark Attendance open with no internet (public/sw.js); nothing else is changed by it.
  useEffect(() => { registerServiceWorker(); }, []);
  return <>{children}</>;
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
