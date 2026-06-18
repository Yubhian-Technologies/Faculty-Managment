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
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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
        description="Review and approve HOD vacancy requests"
        actions={
          <Button asChild>
            <Link href="/principal/vacancies/general-admin">
              + General Admin Vacancy
            </Link>
          </Button>
        }
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
      <ConfirmDialog
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
        title="Approve Vacancy Request?"
        description={`Approve the ${selectedVacancy?.position} vacancy for ${selectedVacancy?.department}. The HOD will be notified.`}
        confirmLabel="Approve"
        onConfirm={handleApprove}
        loading={loading}
      />

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
