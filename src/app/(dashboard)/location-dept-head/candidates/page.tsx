"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";
import { useAuthStore } from "@/store/authStore";

interface LocationCandidate {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  appliedPosition: string;
  department: string;
  qualification?: string;
  status: string;
  createdAt: unknown;
}

export default function LocationDeptHeadCandidatesPage() {
  const isMobile = useMobile();
  const user = useAuthStore((s) => s.user);
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", department: "", qualification: "", notes: "",
  });

  function load() {
    setIsLoading(true);
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => {
        const all = d.candidates ?? [];
        const filtered = user?.department
          ? all.filter((c) => c.department === user.department)
          : all;
        setCandidates(filtered);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, [user?.department]);

  function openAdd() {
    setForm({
      name: "", email: "", phone: "",
      department: user?.department ?? "",
      qualification: "", notes: "",
    });
    setAddOpen(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || !form.department) return;
    setSaving(true);
    try {
      const res = await fetch("/api/location/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to add candidate", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Candidate added", description: "HR Admin will review and shortlist." });
      setAddOpen(false);
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Candidates"
        description={`Candidates for ${user?.department ?? "your"} department`}
        actions={<Button onClick={openAdd}>+ Add Candidate</Button>}
      />

      {isMobile ? (
        <div className="space-y-3">
          {candidates.map((c) => (
            <MobileCard
              key={c.id}
              title={c.name}
              subtitle={c.appliedPosition}
              badge={<StatusBadge status={c.status} />}
              fields={[
                { label: "Email", value: c.email ?? "—" },
                { label: "Phone", value: c.phone ?? "—" },
                { label: "Qualification", value: c.qualification ?? "—" },
              ]}
            />
          ))}
          {!isLoading && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No candidates yet. Add the first candidate for your department.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={candidates as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search candidates..."
          searchKeys={["name", "appliedPosition", "email"]}
          csvFilename="dept-candidates"
          columns={[
            { key: "name", header: "Name" },
            { key: "appliedPosition", header: "Applied For" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as LocationCandidate).qualification ?? "—" },
            { key: "email", header: "Email", render: (r) => (r as unknown as LocationCandidate).email ?? "—" },
            { key: "phone", header: "Phone", render: (r) => (r as unknown as LocationCandidate).phone ?? "—" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationCandidate).status} /> },
            { key: "createdAt", header: "Added", render: (r) => formatDate((r as unknown as LocationCandidate).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Add Faculty Candidate</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dr. Full Name" />
              </div>
              <div className="space-y-2">
                <Label>Email <span className="text-destructive">*</span></Label>
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="candidate@email.com" />
              </div>
              <div className="space-y-2">
                <Label>Phone <span className="text-destructive">*</span></Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="9876543210" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={form.department || "—"} disabled className="bg-muted text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Candidates are added for your own department only.</p>
            </div>
            <div className="space-y-2">
              <Label>Qualification</Label>
              <Input value={form.qualification} onChange={(e) => setForm((f) => ({ ...f, qualification: e.target.value }))} placeholder="M.Tech, Ph.D, etc." />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Reference, source, etc." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!form.name || !form.email || !form.phone || !form.department}>
                Add Candidate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
