"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { PublicationDetailsForm, emptyPublicationDetails, publicationMissingFields } from "@/components/research/PublicationDetailsForm";
import type { ResearchPublication, PublicationDetails } from "@/types";

export default function EditPublicationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const publicationId = params.id;
  const ownCollegeId = useAuthStore((s) => s.user?.collegeId ?? "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [details, setDetails] = useState<PublicationDetails>(emptyPublicationDetails());

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
        setDetails(p.details ?? { ...emptyPublicationDetails(), title: p.title });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load publication" }))
      .finally(() => setLoading(false));
  }, [publicationId, router]);

  const missing = publicationMissingFields(details);
  const isValid = missing.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/college/publications/${publicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ details }),
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
      <div className="max-w-2xl">
        <PageHeader title="Edit Publication" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Edit Publication" description={ownerName} />
      <Card>
        <CardHeader><CardTitle className="text-base">Publication Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <PublicationDetailsForm value={details} onChange={setDetails} ownCollegeId={ownCollegeId} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end pt-4 border-t">
              {!isValid && (
                <p className="text-xs text-destructive sm:mr-auto" role="status">
                  Required: {missing.slice(0, 6).join(", ")}{missing.length > 6 ? ` and ${missing.length - 6} more` : ""}
                </p>
              )}
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
