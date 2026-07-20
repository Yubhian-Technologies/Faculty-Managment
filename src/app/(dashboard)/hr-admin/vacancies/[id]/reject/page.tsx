"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";

interface DeptVacancyRequest {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  deptHeadName: string;
  requiredCount: number;
  justification?: string;
  status: string;
  createdAt: unknown;
}

export default function RejectVacancyRequestPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const requestId = params.id;

  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DeptVacancyRequest | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: DeptVacancyRequest[] }>)
      .then((d) => {
        const found = (d.vacancyRequests ?? []).find((v) => v.id === requestId) ?? null;
        if (!found) {
          toast({ variant: "destructive", title: "Hiring request not found" });
          router.push("/hr-admin/vacancies");
          return;
        }
        if (found.status !== "PENDING_HR") {
          toast({ variant: "destructive", title: "This request is no longer pending your review" });
          router.push("/hr-admin/vacancies");
          return;
        }
        setSelected(found);
      })
      .catch(() => {
        toast({ variant: "destructive", title: "Failed to load hiring request" });
        router.push("/hr-admin/vacancies");
      })
      .finally(() => setLoading(false));
  }, [requestId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/location/vacancy-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", reason }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Request Rejected", description: "Dept Head has been notified." });
      router.push("/hr-admin/vacancies");
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !selected) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Reject Hiring Request" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Reject Hiring Request"
        description={`Rejecting faculty hiring request for ${selected.department} by ${selected.deptHeadName}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rejection Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Explain why..." />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" variant="destructive" loading={saving}>Reject</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
