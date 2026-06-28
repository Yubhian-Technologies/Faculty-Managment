"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, TrendingUp, Users } from "lucide-react";
import type { VacancyRequest } from "@/types";

export default function PrincipalVacanciesPage() {
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVacancy, setSelectedVacancy] = useState<VacancyRequest | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  function loadVacancies() {
    setIsLoading(true);
    fetch("/api/college/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
      .then((data) => setVacancies(data.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacancies" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadVacancies(); }, []);

  const handleApprove = async () => {
    if (!selectedVacancy) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/college/vacancy-requests/${selectedVacancy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Approved", description: "HOD has been notified." });
      setApproveDialogOpen(false);
      setSelectedVacancy(null);
      loadVacancies();
    } catch {
      toast({ variant: "destructive", title: "Action failed", description: "Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedVacancy) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/college/vacancy-requests/${selectedVacancy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED", reason }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Rejected", description: "HOD has been notified." });
      setRejectDialogOpen(false);
      setReason("");
      setSelectedVacancy(null);
      loadVacancies();
    } catch {
      toast({ variant: "destructive", title: "Action failed", description: "Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const openActions = (vacancy: VacancyRequest) => setSelectedVacancy(vacancy);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vacancy Requests"
        description="Review and approve HOD and Vice Principal vacancy requests"
      />

      {isMobile ? (
        <div className="space-y-3">
          {(vacancies ?? []).map((v) => (
            <MobileCard
              key={v.id}
              title={v.position}
              subtitle={`${v.department} · ${v.hodName}`}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "Required", value: v.requiredCount },
                { label: "Submitted", value: formatDate(v.createdAt) },
              ]}
              actions={
                v.status === "PENDING" ? (
                  <>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => { openActions(v); setApproveDialogOpen(true); }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => { openActions(v); setRejectDialogOpen(true); }}
                    >
                      Reject
                    </Button>
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={(vacancies ?? []) as unknown as Record<string, unknown>[]}
          keyExtractor={(row) => row.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["position", "department", "hodName"]}
          csvFilename="principal-vacancies"
          columns={[
            { key: "position", header: "Position" },
            {
              key: "positionCategory",
              header: "Category",
              render: (row) => {
                const cat = (row as unknown as VacancyRequest).positionCategory;
                const label = cat === "TEACHING" ? "Teaching" : cat === "SUPPORTING_STAFF" ? "Support Staff" : cat ?? "—";
                return <Badge variant="secondary" className="text-xs">{label}</Badge>;
              },
            },
            { key: "department", header: "Department" },
            { key: "hodName", header: "Requested By" },
            { key: "requiredCount", header: "Count", render: (row) => (row as unknown as VacancyRequest).requiredCount },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={(row as unknown as VacancyRequest).status} /> },
            { key: "createdAt", header: "Date", render: (row) => formatDate((row as unknown as VacancyRequest).createdAt) },
            {
              key: "actions",
              header: "Actions",
              render: (row) => {
                const v = row as unknown as VacancyRequest;
                return v.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { openActions(v); setApproveDialogOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => { openActions(v); setRejectDialogOpen(true); }}>Reject</Button>
                  </div>
                ) : null;
              },
            },
          ]}
        />
      )}

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve Vacancy Request?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Approving <strong>{selectedVacancy?.position}</strong> ({selectedVacancy?.requiredCount} position{(selectedVacancy?.requiredCount ?? 1) > 1 ? "s" : ""}) for <strong>{selectedVacancy?.department}</strong>.
            </p>

            {/* Ratio data if available */}
            {selectedVacancy?.studentStrength != null && selectedVacancy.studentStrength > 0 && (
              <div className="rounded-lg border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ratio Justification</span>
                </div>
                <div className="grid grid-cols-3 divide-x text-center text-xs py-2">
                  <div className="py-1"><p className="font-bold text-base">{selectedVacancy.studentStrength}</p><p className="text-muted-foreground">Students</p></div>
                  <div className="py-1"><p className="font-bold text-base">{selectedVacancy.totalFacultyRequired}</p><p className="text-muted-foreground">Required (1:15)</p></div>
                  <div className="py-1"><p className="font-bold text-base">{selectedVacancy.requiredCount}</p><p className="text-muted-foreground">This Request</p></div>
                </div>
                {selectedVacancy.cadreRatioData && selectedVacancy.cadreRatioData.length > 0 && (
                  <div className="border-t divide-y">
                    {selectedVacancy.cadreRatioData.map((c) => (
                      <div key={c.key} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">{c.label}</span>
                        <div className="flex items-center gap-3">
                          <span>Req: <strong>{c.required}</strong></span>
                          <span>Now: <strong>{c.current}</strong></span>
                          <span className={`flex items-center gap-0.5 font-semibold ${c.gap > 0 ? "text-red-600" : c.surplus > 0 ? "text-blue-600" : "text-green-600"}`}>
                            {c.gap > 0 ? <><AlertTriangle className="h-3 w-3" />−{c.gap}</> : c.surplus > 0 ? <><TrendingUp className="h-3 w-3" />+{c.surplus}</> : <><CheckCircle2 className="h-3 w-3" />✓</>}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)} disabled={loading}>Cancel</Button>
            <Button onClick={handleApprove} loading={loading}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Reject Vacancy Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Rejecting <strong>{selectedVacancy?.position}</strong> from {selectedVacancy?.department}.
            </p>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide a reason for rejection..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} loading={loading}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
