"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";

interface LocationOffer {
  id: string;
  candidateName: string;
  candidateEmail: string;
  department: string;
  position: string;
  joiningDate: unknown;
  salary: number;
  status: string;
  createdByName: string;
  remarks?: string;
  createdAt: unknown;
}

export default function RejectOfferPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const offerId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offer, setOffer] = useState<LocationOffer | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    fetch("/api/location/offers")
      .then((r) => r.json() as Promise<{ offers: LocationOffer[] }>)
      .then((data) => {
        const o = (data.offers ?? []).find((x) => x.id === offerId);
        if (!o) {
          toast({ variant: "destructive", title: "Offer letter not found" });
          router.push("/administration/offers");
          return;
        }
        setOffer(o);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load offer" }))
      .finally(() => setLoading(false));
  }, [offerId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/location/offers/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", reason }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Offer Letter Rejected",
        description: "HR Admin has been notified.",
      });
      router.push("/administration/offers");
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Reject Offer Letter" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Reject Offer Letter" description={offer ? `${offer.candidateName} — ${offer.department}` : undefined} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rejection Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Rejecting offer letter for <strong>{offer?.candidateName}</strong> ({offer?.department}).
              Joining date: {formatDate(offer?.joiningDate as Parameters<typeof formatDate>[0])}. HR Admin will be notified to revise.
            </p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for rejection..." />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" variant="destructive" loading={saving}>Reject</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
