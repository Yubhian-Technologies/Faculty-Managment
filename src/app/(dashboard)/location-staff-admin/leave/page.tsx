"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import type { LeaveRequest as LocationLeaveRequest } from "@/types/locationStaff";

const LEAVE_TYPE_LABELS: Record<string, string> = { CL: "Casual", EL: "Earned", SL: "Sick", PL: "Privileged", OTHER: "Other" };
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-amber-500/10 text-amber-600 border-amber-500/20", APPROVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", REJECTED: "bg-red-500/10 text-red-600 border-red-500/20" };

export default function LeavePage() {
  const [leaveRequests, setLeaveRequests] = useState<LocationLeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("ALL");

  const loadLeave = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ status: filterStatus });
      const res = await fetch(`/api/location/leave?${params.toString()}`);
      if (res.ok) {
        const d = await res.json() as { leaveRequests: LocationLeaveRequest[] };
        setLeaveRequests(d.leaveRequests ?? []);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load leave requests" });
    } finally {
      setIsLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { loadLeave(); }, [loadLeave]);

  async function handleStatusChange(id: string, newStatus: "APPROVED" | "REJECTED") {
    try {
      const res = await fetch(`/api/location/leave/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast({ variant: "success", title: `Leave ${newStatus.toLowerCase()}` });
        loadLeave();
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    }
  }

  const summary = {
    total: leaveRequests.length,
    pending: leaveRequests.filter((r) => r.status === "PENDING").length,
    approved: leaveRequests.filter((r) => r.status === "APPROVED").length,
    rejected: leaveRequests.filter((r) => r.status === "REJECTED").length,
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link aria-label="Back" href="/location-staff-admin"><ArrowLeft className="h-5 w-5 text-foreground" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Leave Management</Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <CalendarClock className="h-6 w-6" /> Leave Requests
            </h1>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground">Total</span>
          <p className="text-2xl font-bold">{summary.total}</p>
        </div>
        <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
          <span className="text-[11px] text-amber-700">Pending</span>
          <p className="text-2xl font-bold text-amber-600">{summary.pending}</p>
        </div>
        <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20">
          <span className="text-[11px] text-emerald-700">Approved</span>
          <p className="text-2xl font-bold text-emerald-600">{summary.approved}</p>
        </div>
        <div className="bg-red-500/10 p-4 rounded-2xl border border-red-500/20">
          <span className="text-[11px] text-red-700">Rejected</span>
          <p className="text-2xl font-bold text-red-600">{summary.rejected}</p>
        </div>
      </div>

      <div className="space-y-3 bg-card/80 backdrop-blur-sm p-4 rounded-3xl border border-border/60 shadow-xs flex items-center gap-2 flex-wrap">
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
          <Button key={s} variant={filterStatus === s ? "default" : "outline"} size="sm" className="h-8 text-xs rounded-full px-3" onClick={() => setFilterStatus(s)}>
            {s === "ALL" ? "All" : s}
          </Button>
        ))}
        <Button variant="outline" size="sm" className="h-8 text-xs rounded-full px-3" onClick={loadLeave}><RefreshCw className="h-3 w-3 mr-1" /> Refresh</Button>
      </div>

      {isLoading ? (
        <div className="rounded-3xl border border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground">Loading...</div>
      ) : leaveRequests.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
          <CalendarClock className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">No leave requests found</p>
        </div>
      ) : (
        <DataTable<LocationLeaveRequest>
          data={leaveRequests}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          searchPlaceholder="Search by staff name..."
          searchKeys={["staffName", "leaveType"]}
          defaultPageSize={10}
          columns={[
            { key: "staffName", header: "Staff Member" },
            { key: "leaveType", header: "Type", render: (r) => LEAVE_TYPE_LABELS[r.leaveType] ?? r.leaveType },
            { key: "startDate", header: "From", render: (r) => r.startDate },
            { key: "endDate", header: "To", render: (r) => r.endDate },
            { key: "reason", header: "Reason", render: (r) => r.reason },
            { key: "status", header: "Status", render: (r) => <Badge className={`text-[10px] border ${STATUS_COLORS[r.status]}`}>{r.status}</Badge> },
            { key: "createdAt", header: "Applied", render: (r) => (r.createdAt as { toDate?: () => Date }).toDate?.().toLocaleDateString() ?? String(r.createdAt) },
            {
              key: "actions", header: "Actions", render: (r) => {
                if (r.status !== "PENDING") return null;
                return (
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" className="h-7 text-xs rounded-full px-2" onClick={() => handleStatusChange(r.id, "APPROVED")}><CheckCircle2 className="h-3 w-3 mr-0.5" /> Approve</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs rounded-full px-2" onClick={() => handleStatusChange(r.id, "REJECTED")}><XCircle className="h-3 w-3 mr-0.5" /> Reject</Button>
                  </div>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}
