"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { ResearchPublication } from "@/types";

export default function EditPublicationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const publicationId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [title, setTitle] = useState("");
  const [coAuthors, setCoAuthors] = useState("");
  const [journalOrConference, setJournalOrConference] = useState("");
  const [publicationYear, setPublicationYear] = useState(new Date().getFullYear());
  const [indexing, setIndexing] = useState("");
  const [driveLink, setDriveLink] = useState("");

  useEffect(() => {
    fetch(`/api/college/publications/${publicationId}`)
      .then((r) => r.json() as Promise<{ publication?: ResearchPublication; error?: string }>)
      .then((d) => {
        if (!d.publication) {
          toast({ variant: "destructive", title: "Publication not found" });
          router.push("/r-and-d/publications");
          return;
        }
        const p = d.publication;
        setOwnerName(p.ownerName);
        setTitle(p.title);
        setCoAuthors(p.coAuthors);
        setJournalOrConference(p.journalOrConference);
        setPublicationYear(p.publicationYear);
        setIndexing(p.indexing ?? "");
        setDriveLink(p.driveLink ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load publication" }))
      .finally(() => setLoading(false));
  }, [publicationId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/college/publications/${publicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, coAuthors, journalOrConference, publicationYear, indexing, driveLink }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Publication updated" });
      router.push("/r-and-d/publications");
    } catch {
      toast({ variant: "destructive", title: "Failed to update publication" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Publication" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Edit Publication" description={ownerName} />
      <Card>
        <CardHeader><CardTitle className="text-base">Publication Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
              <Button type="submit" loading={saving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
