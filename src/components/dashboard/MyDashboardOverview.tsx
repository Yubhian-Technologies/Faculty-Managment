"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardCheck, UserCheck, UserCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";
import { ROLE_DASHBOARD_PATHS, ROLE_LABELS, type UserRole } from "@/types/core";

interface LeaveBalance { code: string; label: string; unlimited: boolean; remaining?: number }

// One line on what each seat gives you, shown on the "Your seats" cards.
const SEAT_BLURB: Partial<Record<UserRole, string>> = {
  PRINCIPAL: "College-wide approvals, hiring, budget, staff and reports",
  VICE_PRINCIPAL: "College-wide approvals, hiring, budget, staff and reports",
  COLLEGE_ADMIN: "Runs the whole college: people, departments, role assignments and reports",
  HOD: "Your department's faculty, sections, timetable, approvals and budget",
  DEAN: "Subjects and academic administration",
  IQAC_COORDINATOR: "IQAC coordination",
  T_AND_P: "Training & placement, staff attendance",
  R_AND_D: "Research records across the college",
  PLACEMENT_DEPT: "Placement activities",
  EXAM_CELL: "Exam configuration and staff attendance",
  LIBRARY: "Library staff attendance",
};

// The common "My Dashboard" every login starts from - the same for whatever
// their primary role is (faculty, supporting staff, office, ...): who they
// are, their leave, anything waiting on them, and - if they hold seats - a
// card for each that opens that seat's own dashboard. What the seats add to
// the sidebar is built in navConfig's getNavItemsForRoles.
export function MyDashboardOverview() {
  const user = useAuthStore((s) => s.user);
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [pendingAdjustments, setPendingAdjustments] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/leave/balances")
      .then((r) => r.json() as Promise<{ leaveTypes?: LeaveBalance[] }>)
      .then((d) => setBalances(d.leaveTypes ?? []))
      .catch(() => setBalances([]));
    fetch("/api/leave/adjustment-requests")
      .then((r) => r.json() as Promise<{ items?: unknown[] }>)
      .then((d) => setPendingAdjustments(d.items?.length ?? 0))
      .catch(() => setPendingAdjustments(0));
  }, []);

  if (!user) return null;
  const base = ROLE_DASHBOARD_PATHS[user.role] ?? "/";
  const seatRoles = (user.roles ?? user.seatRoles ?? []).filter((r) => r !== user.role);

  return (
    <div className="space-y-4">
      {seatRoles.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your seats</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {seatRoles.map((role) => (
              <Link
                key={role}
                href={ROLE_DASHBOARD_PATHS[role] ?? "/"}
                className="group rounded-lg border p-3 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{ROLE_LABELS[role]}</p>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{SEAT_BLURB[role] ?? "Open this seat's dashboard"}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" />My leave</CardTitle>
            <Link href={`${base}/leave`} className="text-xs text-primary hover:underline">Apply / history</Link>
          </CardHeader>
          <CardContent>
            {balances === null ? (
              <div className="h-12 bg-muted animate-pulse rounded-lg" />
            ) : balances.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leave balance to show yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {balances.map((b) => (
                  <Badge key={b.code} variant="secondary" className="text-xs">
                    {b.label}: {b.unlimited ? "unlimited" : (b.remaining ?? 0)}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Link href="/leave/adjustments">
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <UserCheck className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Adjustment requests</p>
                  <p className="text-xs text-muted-foreground">
                    {pendingAdjustments === null ? "..." : pendingAdjustments === 0 ? "Nothing waiting on you" : `${pendingAdjustments} waiting on you`}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href={`${base}/attendance`}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium">My attendance</p>
              </CardContent>
            </Card>
          </Link>
          <Link href={`${base}/profile`}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <UserCircle className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">My profile</p>
                  <p className="text-xs text-muted-foreground">Personal details, research (R&amp;D), documents</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
