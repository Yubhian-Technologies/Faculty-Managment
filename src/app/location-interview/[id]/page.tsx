"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { stripLeadingZeros } from "@/lib/utils";

interface Candidate {
  name: string;
  email: string;
  department: string;
  appliedPosition: string;
  locationId: string;
  bioDataSubmitted?: boolean;
}

export default function CandidateBioDataPage() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fatherName: "",
    dob: "",
    gender: "",
    address: "",
    aadhaar: "",
    pan: "",
    currentEmployer: "",
    totalExperience: "",
    currentCTC: "",
    expectedCTC: "",
    references: "",
    extraInfo: "",
  });

  useEffect(() => {
    fetch(`/api/location/candidates/${id}`)
      .then((r) => r.json() as Promise<{ candidate: Candidate }>)
      .then((d) => {
        setCandidate(d.candidate);
        if (d.candidate?.bioDataSubmitted) setSubmitted(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/location/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bioData: form }),
      });
      if (res.ok) setSubmitted(true);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-sm w-full mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive text-sm">Invalid or expired link. Please contact HR Admin.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-sm w-full mx-4">
          <CardContent className="pt-6 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="font-semibold">Details Submitted Successfully</h2>
            <p className="text-sm text-muted-foreground">
              Thank you, <strong>{candidate.name}</strong>! Your information has been received.
              The HR team will contact you with further details.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold">Faculty Interview — Bio Data Form</h1>
          <p className="text-sm text-muted-foreground">Please fill all details before your interview</p>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Name:</span> <strong>{candidate.name}</strong></p>
            <p><span className="text-muted-foreground">Email:</span> {candidate.email}</p>
            <p><span className="text-muted-foreground">Department:</span> {candidate.department}</p>
            <p><span className="text-muted-foreground">Applied For:</span> {candidate.appliedPosition}</p>
          </CardContent>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Father&apos;s Name <span className="text-destructive">*</span></Label>
                  <Input value={form.fatherName} onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))} placeholder="Father's full name" required />
                </div>
                <div className="space-y-2">
                  <Label>Date of Birth <span className="text-destructive">*</span></Label>
                  <Input type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Gender <span className="text-destructive">*</span></Label>
                <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select gender..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Current Address <span className="text-destructive">*</span></Label>
                <Textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} placeholder="Door No, Street, City, State — PIN" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Aadhaar Number</Label>
                  <Input value={form.aadhaar} onChange={(e) => setForm((f) => ({ ...f, aadhaar: e.target.value }))} placeholder="XXXX XXXX XXXX" maxLength={14} />
                </div>
                <div className="space-y-2">
                  <Label>PAN Number</Label>
                  <Input value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" maxLength={10} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Professional Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Current / Previous Employer</Label>
                <Input value={form.currentEmployer} onChange={(e) => setForm((f) => ({ ...f, currentEmployer: e.target.value }))} placeholder="College / Institution name" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Total Experience (years)</Label>
                  <Input type="number" min={0} value={form.totalExperience} onChange={(e) => setForm((f) => ({ ...f, totalExperience: stripLeadingZeros(e.target.value) }))} placeholder="3" />
                </div>
                <div className="space-y-2">
                  <Label>Current CTC (₹/annum)</Label>
                  <Input type="number" value={form.currentCTC} onChange={(e) => setForm((f) => ({ ...f, currentCTC: stripLeadingZeros(e.target.value) }))} placeholder="600000" />
                </div>
                <div className="space-y-2">
                  <Label>Expected CTC (₹/annum)</Label>
                  <Input type="number" value={form.expectedCTC} onChange={(e) => setForm((f) => ({ ...f, expectedCTC: stripLeadingZeros(e.target.value) }))} placeholder="700000" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>References</Label>
                <Textarea value={form.references} onChange={(e) => setForm((f) => ({ ...f, references: e.target.value }))} rows={2} placeholder="Name, Designation, Contact (if any)" />
              </div>
              <div className="space-y-2">
                <Label>Any additional information</Label>
                <Textarea value={form.extraInfo} onChange={(e) => setForm((f) => ({ ...f, extraInfo: e.target.value }))} rows={2} placeholder="Publications, awards, patents, etc." />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" loading={saving}
            disabled={!form.fatherName || !form.dob || !form.gender || !form.address}>
            Submit My Details
          </Button>
        </form>
      </div>
    </div>
  );
}
