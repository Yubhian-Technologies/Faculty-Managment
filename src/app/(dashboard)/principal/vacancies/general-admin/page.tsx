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
  "Electrical",
  "Civil",
  "Accounts",
  "Purchase",
  "Horticulture",
  "Maintenance",
  "Water Works",
  "Security",
  "Scholarships",
  "Others",
] as const;

export default function NewGeneralAdminVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [position, setPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [requiredCount, setRequiredCount] = useState(1);
  const [availableCount, setAvailableCount] = useState(0);
  const [justification, setJustification] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const finalPosition = position === "Others" ? customPosition.trim() : position;

  const isValid =
    !!position &&
    (position !== "Others" || customPosition.trim().length > 0) &&
    requiredCount >= 1 &&
    justification.trim().length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/general-admin-vacancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: finalPosition,
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
      toast({ variant: "success", title: "Request submitted to Super Admin", description: "You will be notified once reviewed." });
      router.push("/principal/vacancies");
    } catch {
      toast({ variant: "destructive", title: "Network error. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="Hiring Request"
        description="Submit institution-wide General Admin hiring requests to Super Admin"
      />

      <div className="flex items-start gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <span className="text-blue-700">
          <strong>Institution-wide:</strong> General Admin requests are reviewed by the Super Admin and apply across all colleges of Sri Vishnu Educational Society.
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vacancy Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Scope indicator */}
            <div className="space-y-2">
              <Label>Submitted By</Label>
              <div className="flex items-center gap-2">
                <Input value={user?.name ?? "—"} disabled className="bg-muted" />
                <Badge variant="secondary" className="shrink-0 text-xs">Vice Principal</Badge>
              </div>
            </div>

            {/* Position */}
            <div className="space-y-2">
              <Label>Position / Role <span className="text-destructive">*</span></Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger>
                  <SelectValue placeholder="Select General Admin role..." />
                </SelectTrigger>
                <SelectContent>
                  {GENERAL_ADMIN_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {position === "Others" && (
              <div className="space-y-2">
                <Label>Specify Role <span className="text-destructive">*</span></Label>
                <Input
                  value={customPosition}
                  onChange={(e) => setCustomPosition(e.target.value)}
                  placeholder="Enter the role..."
                />
              </div>
            )}

            {/* Count fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vacancies Required <span className="text-destructive">*</span></Label>
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

            {/* Justification */}
            <div className="space-y-2">
              <Label>Justification <span className="text-destructive">*</span></Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Explain the need for this role..."
                rows={4}
              />
              {justification.length > 0 && justification.trim().length < 10 && (
                <p className="text-xs text-destructive">Minimum 10 characters required</p>
              )}
            </div>
          </CardContent>
        </Card>

        {isValid && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4 text-sm">
              <p className="font-medium text-green-800 mb-1">Request Summary</p>
              <p className="text-green-700">
                <span className="font-semibold">{requiredCount}</span> × {finalPosition} &nbsp;·&nbsp;
                <span className="italic">General Admin</span> &nbsp;·&nbsp; Institution-wide
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={isSubmitting} disabled={!isValid}>
            Submit to Super Admin
          </Button>
        </div>
      </form>
    </div>
  );
}
