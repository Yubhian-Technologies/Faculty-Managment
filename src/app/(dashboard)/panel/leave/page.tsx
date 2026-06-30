"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CalendarClock, Plus, AlertCircle } from "lucide-react";
import type { LeaveBalanceV2, LeaveRequestV2, EmployeeLeaveProfile, LeaveTypeCodeV2 } from "@/types/leave";

const BALANCE_DISPLAY: { code: LeaveTypeCodeV2; label: string; color: string }[] = [
  { code: "CL",   label: "Casual",      color: "text-blue-600" },
  { code: "EL",   label: "Earned",      color: "text-green-600" },
  { code: "SCL",  label: "Spl. Casual", color: "text-purple-600" },
  { code: "ML",   label: "Sick",        color: "text-red-600" },
  { code: "COMP", label: "Comp",        color: "text-amber-600" },
];

const STATUS_STYLES: Record<string, string> = {
  PENDING_HOD:           "bg-yellow-50 text-yellow-700 border-yellow-200",
  PENDING_RATIFICATION:  "bg-blue-50 text-blue-700 border-blue-200",
  PENDING_MANAGEMENT:    "bg-blue-50 text-blue-700 border-blue-200",
  PENDING_MEDICAL_REVIEW:"bg-orange-50 text-orange-700 border-orange-200",
  APPROVED:              "bg-green-50 text-green-700 border-green-200",
  REJECTED:              "bg-red-50 text-red-700 border-red-200",
  RECALLED:              "bg-gray-50 text-gray-600 border-gray-200",
  CANCELLED:             "bg-gray-50 text-gray-500 border-gray-200",
  DRAFT:                 "bg-gray-50 text-gray-500 border-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_HOD:           "Pending HOD",
  PENDING_RATIFICATION:  "Pending Principal",
  PENDING_MANAGEMENT:    "Pending Management",
  PENDING_MEDICAL_REVIEW:"Pending Medical",
  APPROVED:              "Approved",
  REJECTED:              "Rejected",
  RECALLED:              "Recalled",
  CANCELLED:             "Cancelled",
  DRAFT:                 "Draft",
};

const LT_LABELS: Partial<Record<LeaveTypeCodeV2, string>> = {
  CL: "Casual Leave", SCL: "Special Casual Leave", EL: "Earned Leave",
  ML: "Sick Leave", MAT: "Maternity Leave", FPL: "Family Planning Leave",
  COMP: "Compensatory Leave", LND: "Leave Not Due", QUAR: "Quarantine Leave",
  EOL: "Extraordinary Leave", SAB: "Sabbatical Leave", VAC: "Vacation",
};

export default function FacultyLeavePage() {
  const router = useRouter();
  const [balances, setBalances] = useState<LeaveBalanceV2[]>([]);
  const [requests, setRequests] = useState<LeaveRequestV2[]>([]);
  const [profile, setProfile] = useState<EmployeeLeaveProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        fetch("/api/leave/balances"),
        fetch("/api/leave/applications"),
      ]);
      if (balRes.ok) {
        const d = await balRes.json() as { balances: LeaveBalanceV2[]; profile: EmployeeLeaveProfile | null };
        setBalances(d.balances ?? []);
        setProfile(d.profile ?? null);
      }
      if (reqRes.ok) {
        const d = await reqRes.json() as { requests: LeaveRequestV2[] };
        setRequests(d.requests ?? []);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load leave data" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function getBalance(code: LeaveTypeCodeV2) {
    const b = balances.find((x) => x.leaveTypeCode === code);
    if (!b) return null;
    const available = Math.max(0, b.opening + b.credited - b.used - b.pending);
    return { available, used: b.used, pending: b.pending };
  }

  const hasProfile = !!profile;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        description="Apply for leave and track your applications"
        actions={
          <Button onClick={() => router.push("/panel/leave/apply")} disabled={!hasProfile || loading}>
            <Plus className="h-4 w-4 mr-2" />
            Apply Leave
          </Button>
        }
      />

      {/* Profile setup notice */}
      {!loading && !hasProfile && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Leave profile not set up</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Complete your leave profile to initialize your annual entitlements.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push("/panel/leave/setup")} className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100">
            Setup Profile
          </Button>
        </div>
      )}

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BALANCE_DISPLAY.map((lt) => {
          const bal = getBalance(lt.code);
          return (
            <Card key={lt.code}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground truncate">{lt.label}</p>
                <p className={`text-2xl font-bold mt-1 ${lt.color}`}>
                  {loading ? "—" : bal !== null ? bal.available : "—"}
                </p>
                <p className="text-xs text-muted-foreground">days available</p>
                {bal && !loading && (bal.used > 0 || bal.pending > 0) && (
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {bal.used > 0 && `Used: ${bal.used}`}
                    {bal.used > 0 && bal.pending > 0 && " · "}
                    {bal.pending > 0 && `Pending: ${bal.pending}`}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Application history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Applications</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No leave applications"
                description="Your leave applications will appear here once you apply."
                icon={<CalendarClock className="h-8 w-8" />}
              />
            </div>
          ) : (
            <div className="divide-y">
              {requests.map((req) => {
                const statusStyle = STATUS_STYLES[req.status] ?? "bg-gray-50 text-gray-500 border-gray-200";
                const statusLabel = STATUS_LABELS[req.status] ?? req.status;
                return (
                  <Link
                    key={req.id}
                    href={`/panel/leave/${req.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {LT_LABELS[req.leaveTypeCode] ?? req.leaveTypeCode}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(req.fromDate as Parameters<typeof formatDate>[0])}
                        {" → "}
                        {formatDate(req.toDate as Parameters<typeof formatDate>[0])}
                        {" · "}
                        {req.computedDays} day{req.computedDays !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-xs ${statusStyle}`}>
                      {statusLabel}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
