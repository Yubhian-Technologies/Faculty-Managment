"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { resolveOwnProfileTarget } from "@/lib/faculty/ownProfile";

// Wraps a role's own "My Profile" page (HOD, Principal / Vice Principal). A login that has a faculty record is sent to the
// faculty profile - the one profile shown behind the avatar at the top right - at the matching address (same tab, same edit
// page). A login with no faculty record sees the role page exactly as before. See lib/faculty/ownProfile.ts.
//
// The wrapped page is not drawn until this is settled, so the page's own requests are not made for a person who is about to
// be moved, and nobody sees the wrong profile flash by.
export function FacultyProfileRedirect({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const uid = user?.uid;
  const role = useAuthStore((s) => s.user?.role);
  const heldKey = useAuthStore((s) => (s.user?.roles ?? s.user?.seatRoles ?? []).join(","));
  const [stay, setStay] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void resolveOwnProfileTarget({
      pathname,
      role,
      heldRoles: heldKey ? heldKey.split(",") : [],
      login: user,
      fetchMe: async () => {
        const res = await fetch("/api/college/faculty/me", { cache: "no-store" });
        return res.ok ? ((await res.json()) as { facultyRecord?: boolean; faculty?: unknown }) : null;
      },
    }).then((target) => {
      if (!alive) return;
      if (target) router.replace(target);
      else setStay(true);
    });
    return () => { alive = false; };
    // `user` is read when the check runs; the check is per person and page, not per change of the user object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, role, heldKey, pathname, router]);

  if (stay) return <>{children}</>;
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}
