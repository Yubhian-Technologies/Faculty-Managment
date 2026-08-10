"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

type StaffOption = Pick<FMSUser, "uid" | "name" | "role">;

export default function NewPublicationPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [uid, setUid] = useState("");
  const [title, setTitle] = useState("");
  const [coAuthors, setCoAuthors] = useState("");
  const [journalOrConference, setJournalOrConference] = useState("");
  const [publicationYear, setPublicationYear] = useState(new Date().getFullYear());
  const [indexing, setIndexing] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/users?includeAll=true")
      .then((r) => r.json() as Promise<{ users: StaffOption[] }>)
      .then((d) => setStaff((d.users ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff list" }));
  }, []);

  const isValid = !!uid && title.trim().length > 1 && journalOrConference.trim().length > 1 && !!publicationYear;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, title, coAuthors, journalOrConference, publicationYear, indexing, driveLink }),
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
    <div className="max-w-xl">
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
                  {staff.map((s) => (
                    <SelectItem key={s.uid} value={s.uid}>{s.name} - {ROLE_LABELS[s.role] ?? s.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Paper title" />
            </div>
            <div className="space-y-2">
              <Label>Co-Authors</Label>
              <Input value={coAuthors} onChange={(e) => setCoAuthors(e.target.value)} placeholder="Comma-separated names" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Journal / Conference <span className="text-destructive">*</span></Label>
                <Input value={journalOrConference} onChange={(e) => setJournalOrConference(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Year <span className="text-destructive">*</span></Label>
                <Input type="number" value={publicationYear} onChange={(e) => setPublicationYear(Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Indexing</Label>
                <Input value={indexing} onChange={(e) => setIndexing(e.target.value)} placeholder="e.g. SCI, Scopus, WoS, UGC-CARE" />
              </div>
              <div className="space-y-2">
                <Label>Publication Link</Label>
                <Input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} placeholder="DOI / Scopus / Drive link" />
              </div>
            </div>
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
