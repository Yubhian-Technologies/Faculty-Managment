"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { NotificationDrawer } from "@/components/notifications/NotificationDrawer";
import { useAuth } from "@/hooks/useAuth";
import type { ReactNode } from "react";

function AuthInitializer({ children }: { children: ReactNode }) {
  useAuth();
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
