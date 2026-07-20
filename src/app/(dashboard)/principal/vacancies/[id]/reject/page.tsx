"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest } from "@/types";

export default function RejectVacancyPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [vacancy, setVacancy] = useState<VacancyRequest | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
      .then((d) => {
        const v = (d.vacancyRequests ?? []).find((x) => x.id === id) ?? null;
        if (!v) {
          toast({ variant: "destructive", title: "Vacancy request not found" });
          router.push("/principal/vacancies");
          return;
        }
        setVacancy(v);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacancy request" }))
      .finally(() => setLoading(false));
  }, [id, router]);

  async function handleReject() {
    if (!vacancy) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/college/vacancy-requests/${vacancy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED", reason }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Rejected", description: "HOD has been notified." });
      router.push("/principal/vacancies");
    } catch {
      toast({ variant: "destructive", title: "Action failed", description: "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg">
        <PageHeader title="Reject Hiring Request" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Reject Hiring Request"
        description={`Rejecting ${vacancy?.position ?? ""} from ${vacancy?.department ?? ""}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rejection Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Rejecting <strong>{vacancy?.position}</strong> from {vacancy?.department}.
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

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} loading={saving}>Reject</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
