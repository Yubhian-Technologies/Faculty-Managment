"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";

const GENERAL_ADMIN_ROLES = [
  "Electrical", "Civil", "Accounts", "Purchase", "Horticulture",
  "Maintenance", "Water Works", "Security", "Scholarships", "Others",
] as const;

export default function NewGeneralAdminVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [position, setPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [qualification, setQualification] = useState("");
  const [requiredCount, setRequiredCount] = useState(1);
  const [availableCount, setAvailableCount] = useState(0);
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  const finalPosition = position === "Others" ? customPosition.trim() : position;
  const isValid = !!position &&
    (position !== "Others" || customPosition.trim().length > 0) &&
    !!qualification &&
    requiredCount >= 1 &&
    justification.trim().length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/vacancy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: "General Admin",
          position: finalPosition,
          positionCategory: "GENERAL_ADMIN",
          qualification,
          requiredCount,
          availableCount,
          justification: justification.trim(),
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to submit", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Request submitted to Principal" });
      router.push("/vice-principal/vacancies");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="New General Admin Vacancy"
        description="Submit to Principal for approval"
      />

      <div className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <span className="text-blue-700">
          <strong>College-internal:</strong> This request will be reviewed and approved by the Principal before recruitment begins.
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Vacancy Details</CardTitle></CardHeader>
          <CardContent className="space-y-5">

            <div className="space-y-2">
              <Label>Submitted By</Label>
              <div className="flex items-center gap-2">
                <Input value={user?.name ?? "—"} disabled className="bg-muted" />
                <Badge variant="secondary" className="shrink-0 text-xs">Vice Principal</Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Position / Role <span className="text-destructive">*</span></Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  {GENERAL_ADMIN_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {position === "Others" && (
              <div className="space-y-2">
                <Label>Specify Role <span className="text-destructive">*</span></Label>
                <Input value={customPosition} onChange={(e) => setCustomPosition(e.target.value)} placeholder="Enter role..." />
              </div>
            )}

            <div className="space-y-2">
              <Label>Required Qualification <span className="text-destructive">*</span></Label>
              <Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. Diploma / B.Tech in EEE" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vacancies Required <span className="text-destructive">*</span></Label>
                <Input type="number" min={1} value={requiredCount} onChange={(e) => setRequiredCount(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Currently Available</Label>
                <Input type="number" min={0} value={availableCount} onChange={(e) => setAvailableCount(Number(e.target.value))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Justification <span className="text-destructive">*</span></Label>
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why is this role needed?" rows={4} />
              {justification.length > 0 && justification.trim().length < 10 && (
                <p className="text-xs text-destructive">Minimum 10 characters</p>
              )}
            </div>
          </CardContent>
        </Card>

        {isValid && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4 text-sm">
              <p className="font-medium text-green-800 mb-1">Request Summary</p>
              <p className="text-green-700">
                <span className="font-semibold">{requiredCount}</span> × {finalPosition} · General Admin
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!isValid}>Submit to Principal</Button>
        </div>
      </form>
    </div>
  );
}
