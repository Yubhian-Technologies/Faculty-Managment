"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import { Trash2, Plus, CheckCircle2 } from "lucide-react";
import type { CandidateBioData } from "@/types";

interface CandidateInfo {
  name: string;
  position: string;
  department: string;
  bioDataSubmitted: boolean;
}

type CertRow = { key: string; label: string; file: File | null };

function newCertRow(): CertRow {
  return { key: Math.random().toString(36).slice(2), label: "", file: null };
}

export default function CandidateFormPage() {
  const { collegeId, candidateId } = useParams<{ collegeId: string; candidateId: string }>();

  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<CandidateBioData>({});
  const [certRows, setCertRows] = useState<CertRow[]>([newCertRow()]);

  useEffect(() => {
    fetch(`/api/public/candidate-form/${collegeId}/${candidateId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ candidate: CandidateInfo }>) : null))
      .then((d) => {
        if (!d) return;
        setCandidate(d.candidate);
        if (d.candidate.bioDataSubmitted) setSubmitted(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collegeId, candidateId]);

  function updateForm(patch: Partial<CandidateBioData>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function updateCertRow(key: string, patch: Partial<CertRow>) {
    setCertRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeCertRow(key: string) {
    setCertRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const certificates: Array<{ name: string; url: string }> = [];
      for (const row of certRows) {
        if (!row.file) continue;
        const fileRef = ref(
          storage,
          `colleges/${collegeId}/candidateCertificates/${candidateId}/${Date.now()}_${row.file.name}`
        );
        await uploadBytes(fileRef, row.file);
        const url = await getDownloadURL(fileRef);
        certificates.push({ name: row.label.trim() || row.file.name, url });
      }

      const res = await fetch(`/api/public/candidate-form/${collegeId}/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bioData: form, certificates }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to submit", description: "Please try again." });
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
            <p className="text-destructive text-sm">Invalid or expired link. Please contact the institution.</p>
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
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <h2 className="font-semibold">Details Submitted Successfully</h2>
            <p className="text-sm text-muted-foreground">
              Thank you, <strong>{candidate.name}</strong>! Your bio data and certificates have been received.
              We look forward to meeting you at the interview.
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
          <h1 className="text-xl font-bold">Interview — Bio Data Form</h1>
          <p className="text-sm text-muted-foreground">Please fill all details and upload your certificates before your interview</p>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Name:</span> <strong>{candidate.name}</strong></p>
            <p><span className="text-muted-foreground">Position:</span> {candidate.position}</p>
            <p><span className="text-muted-foreground">Department:</span> {candidate.department}</p>
          </CardContent>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Father&apos;s Name</Label>
                  <Input value={form.fatherName ?? ""} onChange={(e) => updateForm({ fatherName: e.target.value })} placeholder="Father's full name" />
                </div>
                <div className="space-y-2">
                  <Label>Mother&apos;s Name</Label>
                  <Input value={form.motherName ?? ""} onChange={(e) => updateForm({ motherName: e.target.value })} placeholder="Mother's full name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Date of Birth <span className="text-destructive">*</span></Label>
                  <Input type="date" value={form.dateOfBirth ?? ""} onChange={(e) => updateForm({ dateOfBirth: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Gender <span className="text-destructive">*</span></Label>
                  <Select value={form.gender ?? ""} onValueChange={(v) => updateForm({ gender: v })}>
                    <SelectTrigger><SelectValue placeholder="Select gender..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Marital Status</Label>
                  <Select value={form.maritalStatus ?? ""} onValueChange={(v) => updateForm({ maritalStatus: v as CandidateBioData["maritalStatus"] })}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Single">Single</SelectItem>
                      <SelectItem value="Married">Married</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.maritalStatus === "Married" && (
                  <div className="space-y-2">
                    <Label>Spouse Name</Label>
                    <Input value={form.spouseName ?? ""} onChange={(e) => updateForm({ spouseName: e.target.value })} placeholder="Spouse's full name" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Aadhaar Number</Label>
                  <Input value={form.aadharNo ?? ""} onChange={(e) => updateForm({ aadharNo: e.target.value })} placeholder="XXXX XXXX XXXX" maxLength={14} />
                </div>
                <div className="space-y-2">
                  <Label>PAN Number</Label>
                  <Input value={form.panNo ?? ""} onChange={(e) => updateForm({ panNo: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Blood Group</Label>
                  <Input value={form.bloodGroup ?? ""} onChange={(e) => updateForm({ bloodGroup: e.target.value })} placeholder="e.g. O+" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Emergency Contact Name</Label>
                  <Input value={form.emergencyContactName ?? ""} onChange={(e) => updateForm({ emergencyContactName: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Emergency Contact Phone</Label>
                  <Input value={form.emergencyContactPhone ?? ""} onChange={(e) => updateForm({ emergencyContactPhone: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Professional Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Current / Previous Employer</Label>
                <Input value={form.currentEmployer ?? ""} onChange={(e) => updateForm({ currentEmployer: e.target.value })} placeholder="College / Institution name" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Total Experience (years)</Label>
                  <Input type="number" min={0} value={form.totalExperienceYears ?? ""} onChange={(e) => updateForm({ totalExperienceYears: stripLeadingZeros(e.target.value) })} placeholder="3" />
                </div>
                <div className="space-y-2">
                  <Label>Current CTC (₹/annum)</Label>
                  <Input type="number" value={form.currentCTC ?? ""} onChange={(e) => updateForm({ currentCTC: stripLeadingZeros(e.target.value) })} placeholder="600000" />
                </div>
                <div className="space-y-2">
                  <Label>Expected CTC (₹/annum)</Label>
                  <Input type="number" value={form.expectedCTC ?? ""} onChange={(e) => updateForm({ expectedCTC: stripLeadingZeros(e.target.value) })} placeholder="700000" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notice Period</Label>
                <Input value={form.noticePeriod ?? ""} onChange={(e) => updateForm({ noticePeriod: e.target.value })} placeholder="e.g. Immediate / 30 days" />
              </div>
              <div className="space-y-2">
                <Label>References</Label>
                <Textarea value={form.references ?? ""} onChange={(e) => updateForm({ references: e.target.value })} rows={2} placeholder="Name, Designation, Contact (if any)" />
              </div>
              <div className="space-y-2">
                <Label>Any additional information</Label>
                <Textarea value={form.additionalInfo ?? ""} onChange={(e) => updateForm({ additionalInfo: e.target.value })} rows={2} placeholder="Publications, awards, patents, etc." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Certificates</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {certRows.map((row) => (
                <div key={row.key} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={row.label}
                      onChange={(e) => updateCertRow(row.key, { label: e.target.value })}
                      placeholder="e.g. PG Degree Certificate, Experience Letter"
                      className="flex-1"
                    />
                    {certRows.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeCertRow(row.key)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <FileUpload
                    accept=".pdf,.png,.jpg,.jpeg"
                    maxSizeMB={5}
                    onFileSelect={(file) => updateCertRow(row.key, { file })}
                    label="Upload Certificate"
                  />
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={() => setCertRows((prev) => [...prev, newCertRow()])}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Certificate
              </Button>
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="w-full"
            loading={saving}
            disabled={!form.dateOfBirth || !form.gender}
          >
            Submit My Details
          </Button>
        </form>
      </div>
    </div>
  );
}
