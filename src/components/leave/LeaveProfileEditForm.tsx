"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { EmployeeLeaveProfile, StaffCategory } from "@/types/leave";

interface LeaveProfileEditFormProps {
  backHref: string;
}

// The profile always already exists by the time this is reachable (the
// roster it's linked from auto-creates it) - this only ever corrects an
// auto-derived value, it never "sets one up" for the first time.
export function LeaveProfileEditForm({ backHref }: LeaveProfileEditFormProps) {
  const params = useParams<{ uid: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<EmployeeLeaveProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [staffCategory, setStaffCategory] = useState<StaffCategory>("vacation");
  const [dateOfJoining, setDateOfJoining] = useState("");

  useEffect(() => {
    fetch(`/api/leave/profile?uid=${params.uid}`)
      .then((r) => r.json() as Promise<{ profile: EmployeeLeaveProfile }>)
      .then(({ profile: p }) => {
        setProfile(p);
        setStaffCategory(p.staffCategory);
        const doj = (p.dateOfJoining as unknown as { toDate?: () => Date }).toDate?.() ?? new Date(p.dateOfJoining as unknown as string);
        setDateOfJoining(doj.toISOString().slice(0, 10));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave profile" }))
      .finally(() => setIsLoading(false));
  }, [params.uid]);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/leave/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: params.uid, staffCategory, dateOfJoining }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: "Leave profile updated" });
      router.push(backHref);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-lg space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title="Edit Leave Profile" description="Correct an auto-derived category or joining date" />
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Staff Category</Label>
            <Select value={staffCategory} onValueChange={(v) => setStaffCategory(v as StaffCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation">Vacation Staff (Teaching)</SelectItem>
                <SelectItem value="non-vacation">Non-Vacation Staff (Supporting)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Auto-derived from their designation. The category this employee converts into once past the
              college&apos;s new-joining threshold.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Date of Joining</Label>
            <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} />
            {profile?.dateOfJoining && (
              <p className="text-xs text-muted-foreground">Currently: {formatDate(profile.dateOfJoining)}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push(backHref)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={isSaving}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
