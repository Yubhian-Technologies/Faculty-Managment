"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";

interface GeneralAdminVacancy {
  id: string;
  position: string;
  requiredCount: number;
  availableCount: number;
  justification?: string;
  status: string;
  createdAt: { seconds: number } | string | null;
}

export default function GeneralAdminVacancyPage() {
  const [vacancies, setVacancies] = useState<GeneralAdminVacancy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [position, setPosition] = useState("");
  const [requiredCount, setRequiredCount] = useState("");
  const [availableCount, setAvailableCount] = useState("");
  const [justification, setJustification] = useState("");

  function load() {
    setIsLoading(true);
    fetch("/api/admin/general-admin-vacancies")
      .then((r) => r.json() as Promise<{ vacancyRequests: GeneralAdminVacancy[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacancy requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const isValid = !!position.trim() && Number(requiredCount) > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/general-admin-vacancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: position.trim(),
          requiredCount: Number(requiredCount),
          availableCount: Number(availableCount || 0),
          justification: justification.trim(),
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to submit request");
      }
      toast({ variant: "success", title: "Vacancy request submitted to Super Admin" });
      setPosition(""); setRequiredCount(""); setAvailableCount(""); setJustification("");
      setShowForm(false);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to submit", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<GeneralAdminVacancy & Record<string, unknown>>[] = [
    { key: "position", header: "Position" },
    { key: "requiredCount", header: "Required" },
    { key: "availableCount", header: "Available", hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "createdAt", header: "Submitted", hideOnMobile: true, render: (row) => formatDate(row.createdAt as Parameters<typeof formatDate>[0]) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="General Admin Vacancies"
        description="Request non-teaching / general administration staff from Super Admin"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            {!showForm && (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Raise Request
              </Button>
            )}
          </div>
        }
      />

      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New General Admin Vacancy Request</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-1">
                  <Label>Position <span className="text-destructive">*</span></Label>
                  <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Office Assistant" />
                </div>
                <div className="space-y-2">
                  <Label>Required Count <span className="text-destructive">*</span></Label>
                  <Input type="number" min={1} value={requiredCount} onChange={(e) => setRequiredCount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Currently Available</Label>
                  <Input type="number" min={0} value={availableCount} onChange={(e) => setAvailableCount(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Justification</Label>
                <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Why this position is needed..." />
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-2 border-t">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
                <Button type="submit" loading={saving} disabled={!isValid}>Submit Request</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <DataTable
            data={vacancies as (GeneralAdminVacancy & Record<string, unknown>)[]}
            columns={columns}
            isLoading={isLoading}
            searchPlaceholder="Search by position..."
            searchKeys={["position"]}
            emptyTitle="No vacancy requests yet"
            emptyDescription="Requests you submit to Super Admin will appear here."
            keyExtractor={(row) => row.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}
