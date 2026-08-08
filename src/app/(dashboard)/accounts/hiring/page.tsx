"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { formatDate } from "@/lib/utils";
import { FileText, CheckCircle2 } from "lucide-react";
import type { Candidate, HiringBatch } from "@/types";

type CreateForm = {
  candidateId: string;
  batchId: string;
  designation: string;
  department: string;
  joiningDate: string;
  ctcAnnual: string;
  subjects: string;
  termsAndConditions: string;
};

const emptyForm = (): CreateForm => ({
  candidateId: "", batchId: "", designation: "", department: "",
  joiningDate: "", ctcAnnual: "", subjects: "", termsAndConditions: "",
});

export default function AccountsHiringPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [existingLetterIds, setExistingLetterIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [sentConfirm, setSentConfirm] = useState<{ name: string; emailedTo?: string } | null>(null);
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });

  useEffect(() => {
    Promise.all([
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string; status?: string }[] }>),
    ])
      .then(([cRes, bRes, lRes]) => {
        const pending = (cRes.candidates ?? []).filter(
          (c) => c.currentStage === "DECISION" && c.status !== "REJECTED"
        );
        setCandidates(pending);
        setBatches(bRes.batches ?? []);
        // A REJECTED offer shouldn't block a fresh one being sent.
        setExistingLetterIds(new Set((lRes.letters ?? []).filter((l) => l.status !== "REJECTED").map((l) => l.candidateId)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    collegeFetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name: string; address: string }>)
      .then((d) => setCollegeInfo({ name: d.name, address: d.address }))
      .catch(() => {});
  }, []);

  function openForm(c: Candidate) {
    const batch = batches.find((b) => b.id === c.batchId);
    setSelected(c);
    setForm({
      ...emptyForm(),
      candidateId: c.id,
      batchId: batch?.id ?? "",
      designation: batch?.position ?? "",
      department: c.department ?? batch?.department ?? "",
      // Negotiated salary, joining date, and terms are captured by the Principal
      // at decision time — auto-fill here rather than re-asking for them.
      ctcAnnual: c.negotiatedSalary != null ? String(c.negotiatedSalary) : "",
      joiningDate: c.dateOfJoining ?? "",
      termsAndConditions: c.termsAndConditions?.length ? c.termsAndConditions.join("\n") : "",
    });
  }

  async function handleSend() {
    const { candidateId, batchId, designation, department, joiningDate, ctcAnnual } = form;
    if (!candidateId || !designation || !department || !joiningDate || !ctcAnnual) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/offer-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          batchId,
          candidateName: selected?.name ?? "",
          designation,
          department,
          joiningDate,
          ctcAnnual: Number(ctcAnnual),
          subjects: form.subjects.split(",").map((s) => s.trim()).filter(Boolean),
          termsAndConditions: form.termsAndConditions,
        }),
      });
      const data = await res.json() as { error?: string; ccEmails?: string[] };
      if (!res.ok) throw new Error(data.error ?? "Failed to send offer");

      const letterFields = {
        candidateName: selected?.name ?? "",
        candidateAddress: selected?.permanentAddress || selected?.residenceAddress,
        designation,
        department,
        collegeName: collegeInfo.name,
        collegeAddress: collegeInfo.address,
        joiningDate,
        letterDate: new Date().toLocaleDateString("en-IN"),
        termsAndConditions: form.termsAndConditions,
      };

      // Accounts reviews and sends the mail themselves (Gmail compose draft) rather
      // than the backend sending it directly — the PDF is downloaded for them to attach.
      await downloadOfferLetterPdf(letterFields, selected?.name ?? candidateId);

      if (selected?.email) {
        const institution = collegeInfo.name || "the institution";
        const subject = `Offer Letter – ${designation} | ${institution}`;
        const body = `Dear ${selected.name},

Greetings from ${institution}.

We are pleased to offer you the position of ${designation} in the ${department} department, effective from ${formatDate(new Date(joiningDate))}.

The offer letter PDF has just been downloaded to your computer - please attach it to this email before sending.

Congratulations, and welcome aboard!

Warm regards,
${institution}`;
        const cc = (data.ccEmails ?? []).join(",");
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selected.email)}&cc=${encodeURIComponent(cc)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(gmailUrl, "_blank");
      }

      setSentConfirm({ name: selected?.name ?? "the candidate", emailedTo: selected?.email });
      setExistingLetterIds((prev) => new Set([...prev, candidateId]));
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      setSelected(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to send offer", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  const pendingOffer = candidates.filter((c) => !existingLetterIds.has(c.id));
  const offered = candidates.filter((c) => existingLetterIds.has(c.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring - Offer Letters"
        description="Send offer letters to Principal-approved candidates"
      />

      {isLoading ? (
        <div className="h-48 bg-muted animate-pulse rounded-lg" />
      ) : pendingOffer.length === 0 && offered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No candidates pending offer letters</p>
            <p className="text-sm mt-1">Candidates appear here after the Principal approves their hiring decision.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pendingOffer.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending Offer Letters ({pendingOffer.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingOffer.map((c) => {
                  const batch = batches.find((b) => b.id === c.batchId);
                  return (
                    <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.email} · {batch?.position ?? c.department}</p>
                      </div>
                      <Button size="sm" onClick={() => openForm(c)}>
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Send Offer
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {offered.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-muted-foreground">Offers Already Sent ({offered.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {offered.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <Badge variant="outline" className="text-green-700 border-green-300 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />Offer Sent
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Offer Letter Form Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setForm(emptyForm()); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Offer Letter - {selected?.name}</DialogTitle>
            <DialogDescription>Fill in employment details, then review and send the composed email.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Designation *</Label>
                <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Assistant Professor" />
              </div>
              <div className="space-y-1.5">
                <Label>Department *</Label>
                <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Computer Science" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Joining Date *</Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Annual CTC (₹) *</Label>
                <Input type="number" min="0" value={form.ctcAnnual} onChange={(e) => setForm((f) => ({ ...f, ctcAnnual: e.target.value }))} placeholder="e.g. 600000" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Subjects (comma-separated)</Label>
              <Input value={form.subjects} onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))} placeholder="e.g. Data Structures, Algorithms" />
            </div>

            <div className="space-y-1.5">
              <Label>Terms &amp; Conditions</Label>
              <Textarea
                value={form.termsAndConditions}
                onChange={(e) => setForm((f) => ({ ...f, termsAndConditions: e.target.value }))}
                placeholder={"One per line, e.g.\nThis appointment is on a probationary basis for one year."}
                rows={3}
              />
            </div>
            <p className="text-xs text-muted-foreground border-t pt-3">
              Once the candidate accepts, College Office can request their login credentials — the Webmaster provisions the account from there.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelected(null); setForm(emptyForm()); }} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSend} loading={isSaving}>Generate &amp; Compose Email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={!!sentConfirm} onOpenChange={(o) => { if (!o) setSentConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Offer Letter Generated</DialogTitle>
            <DialogDescription>
              {sentConfirm?.emailedTo
                ? <>The offer letter PDF has been downloaded, and a Gmail draft to <strong>{sentConfirm?.name}</strong> at <strong>{sentConfirm.emailedTo}</strong> has opened in a new tab — attach the PDF and review before sending.</>
                : <>The offer letter PDF has been downloaded. <strong>{sentConfirm?.name}</strong> has no email on file, so you&apos;ll need to send it manually.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setSentConfirm(null); router.push("/accounts"); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
