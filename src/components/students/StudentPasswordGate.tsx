"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";

// Wraps the student portal. A student whose password is still the one-time one
// the college office issued must choose their own before seeing anything (the
// server refuses their data requests meanwhile - see lib/students/passwordGate.ts).
// While the check is running nothing is shown, so a held student never sees a
// flash of the dashboard; if the check itself fails the portal is shown as
// normal (the server-side gate still applies, so nothing is exposed).
export function StudentPasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "required" | "clear">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/student/me/password", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { mustChangePassword?: boolean }) : {}))
      .then((d) => { if (!cancelled) setState(d.mustChangePassword ? "required" : "clear"); })
      .catch(() => { if (!cancelled) setState("clear"); });
    return () => { cancelled = true; };
  }, []);

  const acknowledge = useCallback(async () => {
    try {
      await fetch("/api/college/student/me/password", { method: "POST" });
    } finally {
      setState("clear");
    }
  }, []);

  if (state === "checking") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (state === "required") {
    return <ChangePasswordDialog open forced onChanged={() => void acknowledge()} />;
  }
  return <>{children}</>;
}
