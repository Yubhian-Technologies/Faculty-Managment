"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, ClipboardCheck, Eye, Lock, UserCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/shared/Avatar";
import { FacultyStatusBadge } from "@/components/faculty/FacultyProfileHub";
import { useAuthStore } from "@/store/authStore";
import type { FacultyStatus } from "@/types";

const SECTIONS = [
  { href: "/panel/profile", title: "My Profile", text: "Your personal, academic and employment details.", Icon: UserCircle },
  { href: "/panel/attendance", title: "My Attendance", text: "Your monthly attendance record and summary.", Icon: ClipboardCheck },
  { href: "/panel/leave", title: "My Leave", text: "Your leave balances and past applications.", Icon: CalendarClock },
] as const;

/**
 * What a RESIGNED/RETIRED faculty member sees instead of a dashboard (and instead of any page they may not
 * open): who they are, why their access is limited, and the three places they can still go. Purely
 * presentational - the API guards are what actually enforce read-only access.
 */
export function ReadOnlyHome({ blockedPath }: { blockedPath?: string }) {
  const user = useAuthStore((s) => s.user);
  const { data: status } = useQuery({
    queryKey: ["read-only-home-status", user?.uid],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/college/faculty/me");
      if (!res.ok) return undefined;
      const d = (await res.json()) as { faculty?: { status?: string } | null };
      return d.faculty?.status;
    },
  });

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="read-only-home">
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-amber-400" />
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <Avatar name={user?.name ?? ""} photoUrl={user?.profilePhotoUrl} size="lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {firstName ? `Welcome, ${firstName}` : "Welcome"}
              </h1>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {status && <FacultyStatusBadge status={status as FacultyStatus} />}
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                  <Eye className="h-3 w-3" /> Read-only access
                </span>
              </div>
            </div>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            You are no longer an active faculty member, so your account is view-only. Your records are safe and
            you can look at them any time below - editing, applying and marking are switched off.
          </p>
        </CardContent>
      </Card>

      {blockedPath && blockedPath !== "/panel" && blockedPath !== "/" && (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" role="status">
          <Lock className="h-4 w-4 shrink-0" /> That page isn&apos;t available with read-only access.
        </p>
      )}

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">You can view</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {SECTIONS.map(({ href, title, text, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-muted-foreground">{text}</span>
              </span>
              <span className="mt-auto flex items-center text-xs font-medium text-primary">
                Open <ChevronRight className="ml-0.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        If you think this is a mistake, please contact your HOD or the college office.
      </p>
    </div>
  );
}
