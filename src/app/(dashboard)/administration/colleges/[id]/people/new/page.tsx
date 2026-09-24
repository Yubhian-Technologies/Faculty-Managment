"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";

// The first person in a new college - see api/administration/college-people.
// Head office only ever appoints the College Admin; that person takes it from
// there (Principal, departments, faculty, office staff) via Role Assignments.
// Just a login, nothing more: no name/phone/joining-date is collected here,
// since whoever actually holds this login can change over time (it's handed
// over by sharing the credentials, not by a formal seat reassignment - the
// API defaults the display name and joining date rather than requiring them).
export default function NewCollegePersonPage() {
  const router = useRouter();
  const { id: collegeId } = useParams<{ id: string }>();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ collegeEmail: "", password: "12345678" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const ready = form.collegeEmail && form.password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    try {
      const res = await fetch("/api/administration/college-people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, seatRole: "COLLEGE_ADMIN", collegeId }),
      });
      const json = await res.json() as { uid?: string; error?: string; seatError?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      toast({
        variant: "success",
        title: json.seatError ? "Person added, but not appointed" : "Added",
        description: json.seatError
          ? `${json.seatError} They can be appointed as College Admin later.`
          : `Default password: ${form.password}.`,
      });
      router.push("/administration/colleges");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add College Admin"
        description="Create the login that runs this college and appoint it College Admin in one step."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              This login becomes College Admin. From there it appoints the Principal, departments, faculty and office staff, from Role Assignments.
            </p>
            <div className="space-y-2">
              <Label>College Email (their login) <span className="text-destructive">*</span></Label>
              <Input type="email" value={form.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="admin@yourcollege.edu" />
            </div>
            <div className="space-y-2">
              <Label>Default Password <span className="text-destructive">*</span></Label>
              <Input value={form.password} onChange={(e) => set({ password: e.target.value })} />
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!ready}>Add</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
