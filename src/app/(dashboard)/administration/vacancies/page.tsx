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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationVacancy {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  submittedByName: string;
  requiredCount: number;
  justification?: string;
  status: string;
  createdAt: unknown;
}

export default function AdministrationVacanciesPage() {
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<LocationVacancy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<LocationVacancy | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: LocationVacancy[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function action(status: string, rej_reason?: string) {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/location/vacancy-requests/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: rej_reason }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: status === "APPROVED" ? "Approved" : "Rejected", description: "HR Admin notified." });
      setApproveOpen(false);
      setRejectOpen(false);
      setSelected(null);
      setReason("");
      load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Location Vacancy Requests" description="Approve or reject HR Admin vacancy requests" />

      {isMobile ? (
        <div className="space-y-3">
          {vacancies.map((v) => (
            <MobileCard
              key={v.id}
              title={v.position}
              subtitle={`${v.department} · ${v.submittedByName}`}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "Required", value: v.requiredCount },
                { label: "Qualification", value: v.qualification ?? "—" },
              ]}
              actions={v.status === "PENDING" ? (
                <>
                  <Button size="sm" className="flex-1" onClick={() => { setSelected(v); setApproveOpen(true); }}>Approve</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => { setSelected(v); setRejectOpen(true); }}>Reject</Button>
                </>
              ) : undefined}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={vacancies as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["position", "department", "submittedByName"]}
          csvFilename="location-vacancies"
          columns={[
            { key: "position", header: "Position" },
            { key: "department", header: "Department" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as LocationVacancy).qualification ?? "—" },
            { key: "submittedByName", header: "Submitted By" },
            { key: "requiredCount", header: "Count", render: (r) => (r as unknown as LocationVacancy).requiredCount },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationVacancy).status} /> },
            { key: "createdAt", header: "Date", render: (r) => formatDate((r as unknown as LocationVacancy).createdAt as Parameters<typeof formatDate>[0]) },
            {
              key: "actions", header: "Actions",
              render: (r) => {
                const v = r as unknown as LocationVacancy;
                return v.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setSelected(v); setApproveOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => { setSelected(v); setRejectOpen(true); }}>Reject</Button>
                  </div>
                ) : null;
              },
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve Vacancy Request?"
        description={`Approve ${selected?.position} in ${selected?.department}. HR Admin will be notified.`}
        confirmLabel="Approve"
        onConfirm={() => void action("APPROVED")}
        loading={loading}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Reject Vacancy Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Rejecting <strong>{selected?.position}</strong> in {selected?.department}.</p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="destructive" onClick={() => void action("REJECTED", reason)} loading={loading}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
