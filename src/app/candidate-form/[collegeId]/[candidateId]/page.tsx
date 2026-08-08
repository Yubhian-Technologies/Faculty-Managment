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
import { DocumentTypeCombobox } from "@/components/shared/DocumentTypeCombobox";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import { DOCUMENT_TYPE_GROUPS } from "@/lib/documentTypes";
import { Trash2, Plus, CheckCircle2 } from "lucide-react";
import type { CandidateBioData, AcademicQualification, WorkExperienceEntry, RelativeInSociety } from "@/types";

const OTHER_DOCUMENTS_CATEGORY = "Other Documents";

function categoryForDocument(label: string): string {
  return DOCUMENT_TYPE_GROUPS.find((g) => g.items.includes(label))?.category ?? OTHER_DOCUMENTS_CATEGORY;
}

function groupRequiredDocuments(labels: string[]): Array<{ category: string; labels: string[] }> {
  const byCategory = new Map<string, string[]>();
  for (const label of labels) {
    const category = categoryForDocument(label);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(label);
  }
  return Array.from(byCategory, ([category, labels]) => ({ category, labels }));
}

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

type QualificationRow = AcademicQualification & { file: File | null };

function newQualificationRow(): QualificationRow {
  return {
    id: Math.random().toString(36).slice(2),
    degree: "", institution: "", yearOfPassing: "", percentageOrCGPA: "",
    file: null,
  };
}

function newExperienceRow(): WorkExperienceEntry {
  return { id: Math.random().toString(36).slice(2), organization: "", designation: "", fromDate: "", toDate: "", responsibilities: "" };
}

function newRelativeRow(): RelativeInSociety {
  return { id: Math.random().toString(36).slice(2), name: "", relationship: "", workingLocation: "", profession: "", experience: "" };
}

export default function CandidateFormPage() {
  const { collegeId, candidateId } = useParams<{ collegeId: string; candidateId: string }>();

  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<CandidateBioData>({});
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [requiredFiles, setRequiredFiles] = useState<Record<string, File | null>>({});
  const [certRows, setCertRows] = useState<CertRow[]>([newCertRow()]);
  const [qualifications, setQualifications] = useState<QualificationRow[]>([newQualificationRow()]);
  const [experiences, setExperiences] = useState<WorkExperienceEntry[]>([newExperienceRow()]);
  const [hasRelatives, setHasRelatives] = useState(false);
  const [relatives, setRelatives] = useState<RelativeInSociety[]>([newRelativeRow()]);

  useEffect(() => {
    fetch(`/api/public/candidate-form/${collegeId}/${candidateId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ candidate: CandidateInfo; requiredDocuments?: string[] }>) : null))
      .then((d) => {
        if (!d) return;
        setCandidate(d.candidate);
        const required = d.requiredDocuments ?? [];
        setRequiredDocuments(required);
        setRequiredFiles(Object.fromEntries(required.map((label) => [label, null])));
        if (d.candidate.bioDataSubmitted) setSubmitted(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collegeId, candidateId]);

  function updateForm(patch: Partial<CandidateBioData>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function updateRequiredFile(label: string, file: File | null) {
    setRequiredFiles((prev) => ({ ...prev, [label]: file }));
  }

  function updateCertRow(key: string, patch: Partial<CertRow>) {
    setCertRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeCertRow(key: string) {
    setCertRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateQualificationRow(id: string, patch: Partial<QualificationRow>) {
    setQualifications((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeQualificationRow(id: string) {
    setQualifications((prev) => prev.filter((r) => r.id !== id));
  }

  function updateExperienceRow(id: string, patch: Partial<WorkExperienceEntry>) {
    setExperiences((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeExperienceRow(id: string) {
    setExperiences((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRelativeRow(id: string, patch: Partial<RelativeInSociety>) {
    setRelatives((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRelativeRow(id: string) {
    setRelatives((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing = requiredDocuments.filter((label) => !requiredFiles[label]);
    if (missing.length > 0) {
      toast({
        variant: "destructive",
        title: "Missing required documents",
        description: `Please upload: ${missing.join(", ")}`,
      });
      return;
    }
    setSaving(true);
    try {
      const certificates: Array<{ name: string; url: string }> = [];
      for (const label of requiredDocuments) {
        const file = requiredFiles[label];
        if (!file) continue;
        const fileRef = ref(
          storage,
          `colleges/${collegeId}/candidateCertificates/${candidateId}/${Date.now()}_${file.name}`
        );
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        certificates.push({ name: label, url });
      }
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

      const qualifications_: AcademicQualification[] = [];
      for (const row of qualifications) {
        if (!row.degree.trim() && !row.institution.trim()) continue;
        const { file, ...rest } = row;
        let certificateUrl = rest.certificateUrl;
        let certificateName = rest.certificateName;
        if (file) {
          const fileRef = ref(
            storage,
            `colleges/${collegeId}/candidateCertificates/${candidateId}/${Date.now()}_${file.name}`
          );
          await uploadBytes(fileRef, file);
          certificateUrl = await getDownloadURL(fileRef);
          certificateName = file.name;
        }
        qualifications_.push({ ...rest, certificateUrl, certificateName });
      }

      const experiences_ = experiences.filter((r) => r.organization.trim() || r.designation.trim());
      const relatives_ = hasRelatives ? relatives.filter((r) => r.name.trim() || r.workingLocation.trim()) : [];

      const res = await fetch(`/api/public/candidate-form/${collegeId}/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bioData: {
            ...form,
            qualifications: qualifications_,
            experiences: experiences_,
            hasRelativesInSociety: hasRelatives,
            relatives: relatives_,
          },
          certificates,
        }),
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
      <div className="max-w-5xl mx-auto space-y-5">
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

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
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
            <CardHeader className="pb-3"><CardTitle className="text-base">Academic Qualifications</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {qualifications.map((row, i) => (
                <div key={row.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Qualification {i + 1}</p>
                    {qualifications.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeQualificationRow(row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Degree / Course</Label>
                      <Input value={row.degree} onChange={(e) => updateQualificationRow(row.id, { degree: e.target.value })} placeholder="e.g. M.Tech" />
                    </div>
                    <div className="space-y-2">
                      <Label>Institution</Label>
                      <Input value={row.institution} onChange={(e) => updateQualificationRow(row.id, { institution: e.target.value })} placeholder="College / University name" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Year of Passing</Label>
                      <Input value={row.yearOfPassing} onChange={(e) => updateQualificationRow(row.id, { yearOfPassing: e.target.value })} placeholder="e.g. 2020" />
                    </div>
                    <div className="space-y-2">
                      <Label>Percentage / CGPA</Label>
                      <Input value={row.percentageOrCGPA} onChange={(e) => updateQualificationRow(row.id, { percentageOrCGPA: e.target.value })} placeholder="e.g. 8.5 CGPA" />
                    </div>
                  </div>
                  <FileUpload
                    accept=".pdf,.png,.jpg,.jpeg"
                    maxSizeMB={5}
                    onFileSelect={(file) => updateQualificationRow(row.id, { file })}
                    label="Upload Certificate"
                  />
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={() => setQualifications((prev) => [...prev, newQualificationRow()])}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Qualification
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Work Experience</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {experiences.map((row, i) => (
                <div key={row.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Experience {i + 1}</p>
                    {experiences.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeExperienceRow(row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Organization</Label>
                      <Input value={row.organization} onChange={(e) => updateExperienceRow(row.id, { organization: e.target.value })} placeholder="College / Company name" />
                    </div>
                    <div className="space-y-2">
                      <Label>Designation</Label>
                      <Input value={row.designation} onChange={(e) => updateExperienceRow(row.id, { designation: e.target.value })} placeholder="e.g. Assistant Professor" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>From</Label>
                      <Input type="month" value={row.fromDate} onChange={(e) => updateExperienceRow(row.id, { fromDate: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>To</Label>
                      <Input type="month" value={row.toDate} onChange={(e) => updateExperienceRow(row.id, { toDate: e.target.value })} placeholder="Leave blank if current" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Responsibilities (optional)</Label>
                    <Textarea value={row.responsibilities ?? ""} onChange={(e) => updateExperienceRow(row.id, { responsibilities: e.target.value })} rows={2} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={() => setExperiences((prev) => [...prev, newExperienceRow()])}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Experience
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Relatives Working in the Society</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button type="button" variant={hasRelatives ? "default" : "outline"} onClick={() => setHasRelatives(true)}>Yes</Button>
                <Button type="button" variant={!hasRelatives ? "default" : "outline"} onClick={() => setHasRelatives(false)}>No</Button>
              </div>
              {hasRelatives && (
                <div className="space-y-4">
                  {relatives.map((row, i) => (
                    <div key={row.id} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">Relative {i + 1}</p>
                        {relatives.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeRelativeRow(row.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Relative&apos;s Name</Label>
                          <Input value={row.name} onChange={(e) => updateRelativeRow(row.id, { name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>Relationship</Label>
                          <Input value={row.relationship} onChange={(e) => updateRelativeRow(row.id, { relationship: e.target.value })} placeholder="e.g. Brother, Spouse" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Working Location</Label>
                          <Input value={row.workingLocation} onChange={(e) => updateRelativeRow(row.id, { workingLocation: e.target.value })} placeholder="College / Department" />
                        </div>
                        <div className="space-y-2">
                          <Label>Profession / Designation</Label>
                          <Input value={row.profession} onChange={(e) => updateRelativeRow(row.id, { profession: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Experience</Label>
                        <Input value={row.experience} onChange={(e) => updateRelativeRow(row.id, { experience: e.target.value })} placeholder="e.g. 5 years" />
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full" onClick={() => setRelatives((prev) => [...prev, newRelativeRow()])}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Another Relative
                  </Button>
                </div>
              )}
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

          {groupRequiredDocuments(requiredDocuments).map(({ category, labels }) => (
            <Card key={category}>
              <CardHeader className="pb-3"><CardTitle className="text-base">{category}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {labels.map((label) => (
                  <div key={label} className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium">
                      {label} <span className="text-destructive">*</span>
                    </p>
                    <FileUpload
                      accept=".pdf,.png,.jpg,.jpeg"
                      maxSizeMB={5}
                      onFileSelect={(file) => updateRequiredFile(label, file)}
                      label="Upload Document"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Additional Documents (Optional)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {certRows.map((row) => (
                <div key={row.key} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <DocumentTypeCombobox
                        value={row.label}
                        onChange={(v) => updateCertRow(row.key, { label: v })}
                        placeholder="Select or search document type..."
                      />
                    </div>
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
            className="w-full md:col-span-2"
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
