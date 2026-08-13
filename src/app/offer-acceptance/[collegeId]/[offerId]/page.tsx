"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { formatDate, toDateInputValue } from "@/lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";
import { PublicFormHeader } from "@/components/shared/PublicFormHeader";

interface OfferSummary {
  candidateName: string;
  designation: string;
  department: string;
  joiningDate: Parameters<typeof formatDate>[0];
  ctcAnnual: number;
  offeredTerms: string[];
  collegeName: string;
  status: "SENT" | "ACCEPTED" | "REJECTED";
  alreadyResponded: boolean;
}

export default function OfferAcceptancePage() {
  const { collegeId, offerId } = useParams<{ collegeId: string; offerId: string }>();

  const [offer, setOffer] = useState<OfferSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [confirmedDate, setConfirmedDate] = useState("");
  const [submitting, setSubmitting] = useState<"ACCEPTED" | "REJECTED" | null>(null);
  const [responded, setResponded] = useState<"ACCEPTED" | "REJECTED" | null>(null);

  useEffect(() => {
    fetch(`/api/public/offer-acceptance/${collegeId}/${offerId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ offer: OfferSummary }>) : null))
      .then((d) => {
        if (!d) return;
        setOffer(d.offer);
        setConfirmedDate(toDateInputValue(d.offer.joiningDate));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collegeId, offerId]);

  const termsRequireAgreement = offer ? offer.offeredTerms.length > 0 : false;

  async function submit(decision: "ACCEPTED" | "REJECTED") {
    if (decision === "ACCEPTED" && termsRequireAgreement && !termsAccepted) {
      toast({ variant: "destructive", title: "Please agree to the Terms & Conditions before accepting" });
      return;
    }
    setSubmitting(decision);
    try {
      const res = await fetch(`/api/public/offer-acceptance/${collegeId}/${offerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          termsAccepted: decision === "ACCEPTED" ? (termsRequireAgreement ? termsAccepted : true) : undefined,
          confirmedDateOfJoining: decision === "ACCEPTED" ? confirmedDate : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to submit");
      }
      setResponded(decision);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to submit", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-sm w-full mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive text-sm">Invalid or expired link. Please contact the institution.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const finalDecision = responded ?? (offer.alreadyResponded ? offer.status : null);

  if (finalDecision === "ACCEPTED" || finalDecision === "REJECTED") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <div className="max-w-sm w-full space-y-4">
          <PublicFormHeader collegeName={offer.collegeName} />
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              {finalDecision === "ACCEPTED" ? (
                <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
              ) : (
                <XCircle className="h-12 w-12 text-muted-foreground mx-auto" />
              )}
              <h2 className="font-semibold">
                {finalDecision === "ACCEPTED" ? "Offer Accepted" : "Offer Response Recorded"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {finalDecision === "ACCEPTED"
                  ? `Thank you, ${offer.candidateName}! Your response has been recorded. The office will be in touch about next steps.`
                  : "Your response has been recorded. Thank you for letting us know."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-5">
        <PublicFormHeader collegeName={offer.collegeName} />
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold">Offer Letter</h1>
          <p className="text-sm text-muted-foreground">Please review your offer and respond below</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Offer Details</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Candidate:</span> <strong>{offer.candidateName}</strong></p>
            <p><span className="text-muted-foreground">Position:</span> {offer.designation}</p>
            <p><span className="text-muted-foreground">Department:</span> {offer.department}</p>
            <p><span className="text-muted-foreground">Annual CTC:</span> ₹{offer.ctcAnnual.toLocaleString("en-IN")}</p>
            <p><span className="text-muted-foreground">Proposed Joining Date:</span> {formatDate(offer.joiningDate)}</p>
          </CardContent>
        </Card>

        {offer.offeredTerms.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Terms &amp; Conditions</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm list-disc pl-4">
                {offer.offeredTerms.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
              <label className="flex items-start gap-2 text-sm pt-3 mt-3 border-t cursor-pointer">
                <Checkbox checked={termsAccepted} onCheckedChange={() => setTermsAccepted((v) => !v)} className="mt-0.5" />
                I have read and agree to the above Terms &amp; Conditions
              </label>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Confirm Date of Joining</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="confirmedDate">Date of Joining</Label>
              <Input id="confirmedDate" type="date" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-2">
          <Button
            type="button"
            variant="destructive"
            loading={submitting === "REJECTED"}
            disabled={!!submitting}
            onClick={() => void submit("REJECTED")}
          >
            <XCircle className="h-4 w-4 mr-1.5" /> Reject Offer
          </Button>
          <Button
            type="button"
            className="bg-green-600 hover:bg-green-700"
            loading={submitting === "ACCEPTED"}
            disabled={!!submitting || (termsRequireAgreement && !termsAccepted)}
            onClick={() => void submit("ACCEPTED")}
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Accept Offer
          </Button>
        </div>
      </div>
    </div>
  );
}
