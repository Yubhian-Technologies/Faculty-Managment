"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";

// The first people in a new college - see api/administration/college-people.
export default function NewCollegePersonPage() {
  const router = useRouter();
  const { id: collegeId } = useParams<{ id: string }>();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", collegeEmail: "", password: "12345678", phone: "", designation: "", dateOfJoining: "", seatRole: "COLLEGE_ADMIN",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const ready = form.name && form.collegeEmail && form.password && form.dateOfJoining;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    try {
      const res = await fetch("/api/administration/college-people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, seatRole: form.seatRole === "NONE" ? undefined : form.seatRole, collegeId }),
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
          ? `${json.seatError} Appoint them in Role Assignments.`
          : `Default password: ${form.password}.`,
      });
      router.push(`/administration/role-assignments?collegeId=${collegeId}`);
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
        description="Create the person who will run this college and appoint them College Admin (or Principal) in one step."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Appoint as</Label>
              <Select value={form.seatRole} onValueChange={(v) => set({ seatRole: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COLLEGE_ADMIN">College Admin</SelectItem>
                  <SelectItem value="PRINCIPAL">Principal</SelectItem>
                  <SelectItem value="NONE">No seat yet</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The College Admin then adds departments, faculty and office staff, and can later appoint the Principal from among them.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>College Email (their login) <span className="text-destructive">*</span></Label>
              <Input type="email" value={form.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="name@yourcollege.edu" />
              <p className="text-xs text-muted-foreground">
                This is their own email for life - they keep it whichever seats they hold. Seat / role emails are set separately on the seat.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Default Password</Label>
              <Input value={form.password} onChange={(e) => set({ password: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={form.designation} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. Administrator" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Date of Joining <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.dateOfJoining} onChange={(e) => set({ dateOfJoining: e.target.value })} />
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
