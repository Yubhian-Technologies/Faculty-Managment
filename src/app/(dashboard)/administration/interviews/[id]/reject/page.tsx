"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";

interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  notes?: string;
  status: string;
}

export default function RejectInterviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const interviewId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [interview, setInterview] = useState<LocationInterview | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    fetch(`/api/location/interviews/${interviewId}`)
      .then((r) => r.json() as Promise<{ interview?: LocationInterview }>)
      .then((data) => {
        if (!data.interview) {
          toast({ variant: "destructive", title: "Interview not found" });
          router.push(`/administration/interviews/${interviewId}`);
          return;
        }
        setInterview(data.interview);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load interview" }))
      .finally(() => setLoading(false));
  }, [interviewId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/location/interviews/${interviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", reason }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Interview Plan Rejected",
        description: "HR Admin has been notified.",
      });
      router.push(`/administration/interviews/${interviewId}`);
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Reject Interview Plan" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Reject Interview Plan" description={interview?.title} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rejection Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Rejecting <strong>{interview?.title}</strong>. HR Admin will be notified.
            </p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for rejection..." />
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
