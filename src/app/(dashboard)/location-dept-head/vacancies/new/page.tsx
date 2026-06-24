"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment } from "@/types";

export default function NewDeptVacancyPage() {
  const router = useRouter();
  const [depts, setDepts] = useState<LocationDepartment[]>([]);
  const [department, setDepartment] = useState("");
  const [qualification, setQualification] = useState("");
  const [requiredCount, setRequiredCount] = useState(1);
  const [availableCount, setAvailableCount] = useState(0);
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/location/departments")
      .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
      .then((d) => setDepts(d.departments ?? []))
      .catch(() => {});
  }, []);

  const isValid = !!department && !!qualification && requiredCount >= 1 && justification.trim().length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/location/vacancy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, qualification, requiredCount, availableCount, justification }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to submit", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Request submitted to HR Admin" });
      router.push("/location-dept-head/vacancies");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="New Faculty Vacancy Request" description="Submit to HR Admin for review" />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vacancy Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Position</Label>
              <Input value="Faculty" disabled className="bg-muted text-muted-foreground" />
              <p className="text-xs text-muted-foreground">All vacancy requests are for Faculty positions.</p>
            </div>

            <div className="space-y-2">
              <Label>Department <span className="text-destructive">*</span></Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger><SelectValue placeholder="Select department..." /></SelectTrigger>
                <SelectContent>
                  {depts.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Required Qualification <span className="text-destructive">*</span></Label>
              <Input
                value={qualification}
                onChange={(e) => setQualification(e.target.value)}
                placeholder="e.g. M.Tech / Ph.D in relevant field"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Faculty Vacancies Required <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  value={requiredCount}
                  onChange={(e) => setRequiredCount(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Currently Available</Label>
                <Input
                  type="number"
                  min={0}
                  value={availableCount}
                  onChange={(e) => setAvailableCount(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Justification <span className="text-destructive">*</span></Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Why is this faculty position needed?"
                rows={4}
              />
              {justification.length > 0 && justification.trim().length < 10 && (
                <p className="text-xs text-destructive">Minimum 10 characters</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!isValid}>Submit to HR Admin</Button>
        </div>
      </form>
    </div>
  );
}
