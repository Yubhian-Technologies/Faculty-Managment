"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { PublicationDetailsForm, emptyPublicationDetails, isPublicationDetailsValid } from "@/components/research/PublicationDetailsForm";
import { ROLE_LABELS } from "@/types";
import type { FMSUser, PublicationDetails } from "@/types";

type StaffOption = Pick<FMSUser, "uid" | "name" | "role">;

export default function NewPublicationPage() {
  const router = useRouter();
  const ownCollegeId = useAuthStore((s) => s.user?.collegeId ?? "");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [uid, setUid] = useState("");
  const [details, setDetails] = useState<PublicationDetails>(emptyPublicationDetails());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // includeAll=true is needed to include PRINCIPAL (normally excluded from
    // this endpoint by default) - every non-staff account (Student, Class
    // Leader, Accounts/Finance) is filtered out below, a publication can
    // only ever belong to an academic/administrative staff member.
    fetch("/api/college/users?includeAll=true")
      .then((r) => r.json() as Promise<{ users: StaffOption[] }>)
      .then((d) => setStaff(
        (d.users ?? [])
          .filter((u) => PUBLICATION_ELIGIBLE_ROLES.includes(u.role))
          .sort((a, b) => a.name.localeCompare(b.name))
      ))
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff list" }));
  }, []);

  // Grouped by role (Faculty first, then each office role) rather than one
  // long undifferentiated list - matches PUBLICATION_ELIGIBLE_ROLES' order.
  const staffByRole = PUBLICATION_ELIGIBLE_ROLES
    .map((role) => ({ role, members: staff.filter((s) => s.role === role) }))
    .filter((g) => g.members.length > 0);

  const isValid = !!uid && isPublicationDetailsValid(details);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, details }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to add publication", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Publication added" });
      router.push("/r-and-d/publications");
    } catch {
      toast({ variant: "destructive", title: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add Publication" description="Record an official publication for a staff member" />
      <Card>
        <CardHeader><CardTitle className="text-base">Publication Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Staff Member <span className="text-destructive">*</span></Label>
              <Select value={uid} onValueChange={setUid}>
                <SelectTrigger><SelectValue placeholder="Select staff member..." /></SelectTrigger>
                <SelectContent>
                  {staffByRole.map((g) => (
                    <SelectGroup key={g.role}>
                      <SelectLabel>{ROLE_LABELS[g.role] ?? g.role}</SelectLabel>
                      {g.members.map((s) => (
                        <SelectItem key={s.uid} value={s.uid}>{s.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <PublicationDetailsForm value={details} onChange={setDetails} ownCollegeId={ownCollegeId} />

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Add Publication</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
