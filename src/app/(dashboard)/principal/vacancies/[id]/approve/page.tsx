"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest } from "@/types";

export default function ApproveVacancyPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [vacancy, setVacancy] = useState<VacancyRequest | null>(null);
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

  async function handleApprove() {
    if (!vacancy) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/college/vacancy-requests/${vacancy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Approved", description: "HOD has been notified." });
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
        <PageHeader title="Approve Hiring Request" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Approve Hiring Request?"
        description={`Review the details for ${vacancy?.position ?? ""} before approving`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Approving <strong>{vacancy?.position}</strong> ({vacancy?.requiredCount} position{(vacancy?.requiredCount ?? 1) > 1 ? "s" : ""}) for <strong>{vacancy?.department}</strong>.
          </p>

          {vacancy?.studentStrength != null && vacancy.studentStrength > 0 && (
            <div className="rounded-lg border bg-muted/30 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ratio Justification</span>
              </div>
              <div className="grid grid-cols-3 divide-x text-center text-xs py-2">
                <div className="py-1"><p className="font-bold text-base">{vacancy.studentStrength}</p><p className="text-muted-foreground">Students</p></div>
                <div className="py-1"><p className="font-bold text-base">{vacancy.totalFacultyRequired}</p><p className="text-muted-foreground">Required (1:15)</p></div>
                <div className="py-1"><p className="font-bold text-base">{vacancy.requiredCount}</p><p className="text-muted-foreground">This Request</p></div>
              </div>
              {vacancy.cadreRatioData && vacancy.cadreRatioData.length > 0 && (
                <div className="border-t divide-y">
                  {vacancy.cadreRatioData.map((c) => (
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

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
            <Button onClick={handleApprove} loading={saving}>Approve</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
