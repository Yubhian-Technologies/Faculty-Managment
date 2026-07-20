"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";

interface LocationVacancy {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  deptHeadName: string;
  forwardedByName?: string;
  requiredCount: number;
  justification?: string;
  status: string;
  createdAt: unknown;
}

export default function RejectVacancyPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const vacancyId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vacancy, setVacancy] = useState<LocationVacancy | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: LocationVacancy[] }>)
      .then((data) => {
        const v = (data.vacancyRequests ?? []).find((x) => x.id === vacancyId);
        if (!v) {
          toast({ variant: "destructive", title: "Vacancy request not found" });
          router.push("/administration/vacancies");
          return;
        }
        setVacancy(v);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacancy" }))
      .finally(() => setLoading(false));
  }, [vacancyId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/location/vacancy-requests/${vacancyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED", reason }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Vacancy Rejected",
        description: "HR Admin and Dept Head have been notified.",
      });
      router.push("/administration/vacancies");
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Reject Hiring Request" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Reject Hiring Request" description={vacancy ? `${vacancy.position} — ${vacancy.department}` : undefined} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rejection Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Rejecting faculty vacancy for <strong>{vacancy?.department}</strong> ({vacancy?.requiredCount} position(s)) requested by {vacancy?.deptHeadName}.
            </p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
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
