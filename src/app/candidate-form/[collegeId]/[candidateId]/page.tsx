"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/shared/FileUpload";
import { DocumentTypeCombobox } from "@/components/shared/DocumentTypeCombobox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PublicFormHeader } from "@/components/shared/PublicFormHeader";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import { DOCUMENT_TYPE_GROUPS, EDUCATION_DOCUMENT_TEMPLATES } from "@/lib/documentTypes";
import { Trash2, Plus, CheckCircle2 } from "lucide-react";
import { SUB_CASTES_BY_CASTE } from "@/types";
import type { CandidateBioData, AcademicQualification, WorkExperienceEntry, RelativeInSociety, Caste } from "@/types";

const OTHER_DOCUMENTS_CATEGORY = "Other Documents";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
// AP/Telangana reservation categories (with BC sub-groups), as on the paper bio-data form.
const RELIGIONS = ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other"];
const CASTE_CATEGORIES = ["OC", "BC-A", "BC-B", "BC-C", "BC-D", "BC-E", "SC", "ST", "EWS", "Other"];

function onlyDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, "").slice(0, maxLen);
}

// Digits with at most one decimal point (percentage / CGPA).
function decimalOnly(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
}

// This form's Caste categories split BC into BC-A..BC-E (the paper form's
// AP/Telangana sub-groups), but the shared SUB_CASTES_BY_CASTE picklist
// (also used by the faculty Personal Details form) only has one bucket for
// all of BC - so every BC-* group shares that same sub-caste list.
function subCasteOptionsFor(caste: string): string[] {
  if (caste === "OC" || caste === "SC" || caste === "ST") return SUB_CASTES_BY_CASTE[caste as Caste] ?? [];
  if (caste.startsWith("BC")) return SUB_CASTES_BY_CASTE.BC ?? [];
  return []; // EWS / Other - no fixed list, falls back to free text
}

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

// sourceLabel marks a row auto-created from one of the HOD's required
// education documents (e.g. "10th Certificate & Marks Memo") — the degree
// tile is prefilled/locked from EDUCATION_DOCUMENT_TEMPLATES and the row
// can't be removed, since it stands in for that required-document upload.
type QualificationRow = AcademicQualification & { file: File | null; sourceLabel?: string };

function newQualificationRow(sourceLabel?: string, degree?: string): QualificationRow {
  return {
    id: Math.random().toString(36).slice(2),
    degree: degree ?? "", institution: "", yearOfPassing: "", percentageOrCGPA: "",
    file: null,
    sourceLabel,
  };
}

function institutionPlaceholderFor(sourceLabel?: string): string {
  if (!sourceLabel) return "College / University name";
  if (sourceLabel.startsWith("10th")) return "School name";
  if (sourceLabel.startsWith("Intermediate")) return "Junior College name";
  return "College / University name";
}

function newExperienceRow(): WorkExperienceEntry {
  return { id: Math.random().toString(36).slice(2), organization: "", designation: "", fromDate: "", toDate: "", responsibilities: "" };
}

function newRelativeRow(): RelativeInSociety {
  return { id: Math.random().toString(36).slice(2), name: "", relationship: "", workingLocation: "", profession: "", experience: "" };
}

export default function CandidateFormPage() {
  const { collegeId, candidateId } = useParams<{ collegeId: string; candidateId: string }>();
  const searchParams = useSearchParams();
  const applicationId = searchParams.get("applicationId") ?? "";

  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [collegeName, setCollegeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [form, setForm] = useState<CandidateBioData>({});
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [requiredFiles, setRequiredFiles] = useState<Record<string, File | null>>({});
  const [certRows, setCertRows] = useState<CertRow[]>([newCertRow()]);
  const [qualifications, setQualifications] = useState<QualificationRow[]>([newQualificationRow()]);
  const [experiences, setExperiences] = useState<WorkExperienceEntry[]>([newExperienceRow()]);
  const [hasRelatives, setHasRelatives] = useState(false);
  const [relatives, setRelatives] = useState<RelativeInSociety[]>([newRelativeRow()]);

  useEffect(() => {
    if (!applicationId) { setLoading(false); return; }
    fetch(`/api/public/candidate-form/${collegeId}/${candidateId}?applicationId=${applicationId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ candidate: CandidateInfo; collegeName?: string; requiredDocuments?: string[] }>) : null))
      .then((d) => {
        if (!d) return;
        setCandidate(d.candidate);
        setCollegeName(d.collegeName ?? "");
        const required = d.requiredDocuments ?? [];
        setRequiredDocuments(required);
        const templatedLabels = required.filter((label) => EDUCATION_DOCUMENT_TEMPLATES[label]);
        setRequiredFiles(
          Object.fromEntries(required.filter((label) => !EDUCATION_DOCUMENT_TEMPLATES[label]).map((label) => [label, null]))
        );
        if (templatedLabels.length > 0) {
          setQualifications(templatedLabels.map((label) => newQualificationRow(label, EDUCATION_DOCUMENT_TEMPLATES[label])));
        }
        if (d.candidate.bioDataSubmitted) setSubmitted(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collegeId, candidateId, applicationId]);

  function updateForm(patch: Partial<CandidateBioData>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function updateResearchProfile(patch: Partial<NonNullable<CandidateBioData["researchProfile"]>>) {
    setForm((f) => ({ ...f, researchProfile: { ...f.researchProfile, ...patch } }));
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

  // Collects a "Missing <field>" / "<field> (reason)" message per problem, so the
  // candidate sees exactly what to fix rather than a generic failure.
  function collectFieldErrors(): string[] {
    const errors: string[] = [];
    const currentYear = new Date().getFullYear();

    const todayStr = new Date().toISOString().split("T")[0];
    if (!form.dateOfBirth) {
      errors.push("Missing Date of Birth");
    } else if (form.dateOfBirth > todayStr) {
      errors.push("Date of Birth cannot be in the future");
    }
    if (!form.gender) errors.push("Missing Gender");
    if (!form.bloodGroup) errors.push("Missing Blood Group");
    if (!form.religion) errors.push("Missing Religion");
    if (!form.caste) errors.push("Missing Caste / Category");
    if (!form.emergencyContactName?.trim()) errors.push("Missing Emergency Contact Name");

    if (!form.emergencyContactPhone?.trim()) {
      errors.push("Missing Emergency Contact Phone");
    } else if (!/^\d{10}$/.test(form.emergencyContactPhone)) {
      errors.push("Emergency Contact Phone must be 10 digits");
    }
    if (form.aadharNo && !/^\d{12}$/.test(form.aadharNo)) errors.push("Aadhaar Number must be 12 digits");
    if (form.panNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.panNo)) errors.push("PAN Number must match ABCDE1234F");

    for (const q of qualifications) {
      const isActive = !!q.sourceLabel || !!q.degree.trim() || !!q.institution.trim();
      if (!isActive) continue;
      const label = q.sourceLabel || q.degree || q.institution;
      if (!q.yearOfPassing.trim()) {
        errors.push(`Missing Year of Passing for ${label}`);
      } else if (!/^\d{4}$/.test(q.yearOfPassing) || Number(q.yearOfPassing) < 1950 || Number(q.yearOfPassing) > currentYear) {
        errors.push(`Year of Passing for ${label} must be a valid year (1950–${currentYear})`);
      }
      if (!q.percentageOrCGPA.trim()) {
        errors.push(`Missing Percentage / CGPA for ${label}`);
      } else if (Number.isNaN(Number(q.percentageOrCGPA))) {
        errors.push(`Percentage / CGPA for ${label} must be a number`);
      }
    }
    return errors;
  }

  function handleSubmitClick(e: React.FormEvent) {
    e.preventDefault();

    const errors = collectFieldErrors();

    const missingOther = requiredDocuments
      .filter((label) => !EDUCATION_DOCUMENT_TEMPLATES[label])
      .filter((label) => !requiredFiles[label]);
    const missingTemplated = qualifications
      .filter((q) => q.sourceLabel && !q.file)
      .map((q) => q.sourceLabel as string);
    for (const doc of [...missingOther, ...missingTemplated]) {
      errors.push(`Missing document: ${doc}`);
    }

    if (errors.length > 0) {
      toast({
        variant: "destructive",
        title: "Please fix before submitting",
        description: errors.join(" · "),
      });
      return;
    }
    setConfirmOpen(true);
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const certificates: Array<{ name: string; url: string }> = [];
      for (const label of requiredDocuments.filter((l) => !EDUCATION_DOCUMENT_TEMPLATES[l])) {
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
        const { file, sourceLabel, ...rest } = row;
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
          // Also surface a source-labeled entry so office/HOD document review
          // (which lists Candidate.certificates flat) still shows this file.
          if (sourceLabel) certificates.push({ name: sourceLabel, url: certificateUrl });
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
      setConfirmOpen(false);
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
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <div className="max-w-sm w-full space-y-4">
          <PublicFormHeader collegeName={collegeName} />
          <Card>
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-5">
        <PublicFormHeader collegeName={collegeName} />
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

        <form onSubmit={handleSubmitClick} className="space-y-5">
        <Accordion type="multiple" className="space-y-3">
          <AccordionItem value="personal" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Personal Details</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="fatherName">Father&apos;s Name</Label>
                  <Input id="fatherName" value={form.fatherName ?? ""} onChange={(e) => updateForm({ fatherName: e.target.value })} placeholder="Father's full name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="motherName">Mother&apos;s Name</Label>
                  <Input id="motherName" value={form.motherName ?? ""} onChange={(e) => updateForm({ motherName: e.target.value })} placeholder="Mother's full name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of Birth <span className="text-destructive">*</span></Label>
                  <Input id="dateOfBirth" type="date" max={new Date().toISOString().split("T")[0]} value={form.dateOfBirth ?? ""} onChange={(e) => updateForm({ dateOfBirth: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">Gender <span className="text-destructive">*</span></Label>
                  <Select value={form.gender ?? ""} onValueChange={(v) => updateForm({ gender: v })}>
                    <SelectTrigger id="gender"><SelectValue placeholder="Select gender..." /></SelectTrigger>
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
                  <Label htmlFor="maritalStatus">Marital Status</Label>
                  <Select value={form.maritalStatus ?? ""} onValueChange={(v) => updateForm({ maritalStatus: v as CandidateBioData["maritalStatus"] })}>
                    <SelectTrigger id="maritalStatus"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Single">Single</SelectItem>
                      <SelectItem value="Married">Married</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.maritalStatus === "Married" && (
                  <div className="space-y-2">
                    <Label htmlFor="spouseName">Spouse Name</Label>
                    <Input id="spouseName" value={form.spouseName ?? ""} onChange={(e) => updateForm({ spouseName: e.target.value })} placeholder="Spouse's full name" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="aadharNo">Aadhaar Number</Label>
                  <Input id="aadharNo" value={form.aadharNo ?? ""} inputMode="numeric" onChange={(e) => updateForm({ aadharNo: onlyDigits(e.target.value, 12) })} placeholder="12-digit number" maxLength={12} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="panNo">PAN Number</Label>
                  <Input id="panNo" value={form.panNo ?? ""} onChange={(e) => updateForm({ panNo: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="bloodGroup">Blood Group <span className="text-destructive">*</span></Label>
                  <Select value={form.bloodGroup ?? ""} onValueChange={(v) => updateForm({ bloodGroup: v })}>
                    <SelectTrigger id="bloodGroup"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {BLOOD_GROUPS.map((bg) => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="religion">Religion <span className="text-destructive">*</span></Label>
                  <Select value={form.religion ?? ""} onValueChange={(v) => updateForm({ religion: v })}>
                    <SelectTrigger id="religion"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {RELIGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="caste">Caste / Category <span className="text-destructive">*</span></Label>
                  <Select value={form.caste ?? ""} onValueChange={(v) => updateForm({ caste: v, subCaste: undefined })}>
                    <SelectTrigger id="caste"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {CASTE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subCaste">Sub-caste / Community</Label>
                  {(() => {
                    const subCasteOptions = subCasteOptionsFor(form.caste ?? "");
                    if (subCasteOptions.length === 0) {
                      return (
                        <Input id="subCaste" value={form.subCaste ?? ""} onChange={(e) => updateForm({ subCaste: e.target.value })} placeholder="e.g. Kapu, Reddy, Naidu..." />
                      );
                    }
                    const isOther = !!form.subCaste && (form.subCaste === "OTHER" || !subCasteOptions.includes(form.subCaste));
                    return (
                      <>
                        <Select
                          value={isOther ? "OTHER" : (form.subCaste ?? "")}
                          onValueChange={(v) => updateForm({ subCaste: v })}
                        >
                          <SelectTrigger id="subCaste"><SelectValue placeholder="Select sub-caste..." /></SelectTrigger>
                          <SelectContent>
                            {subCasteOptions.map((sc) => <SelectItem key={sc} value={sc}>{sc}</SelectItem>)}
                            <SelectItem value="OTHER">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        {isOther && (
                          <Input
                            value={form.subCaste === "OTHER" ? "" : form.subCaste ?? ""}
                            onChange={(e) => updateForm({ subCaste: e.target.value || "OTHER" })}
                            placeholder="Please specify"
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="emergencyContactName">Emergency Contact Name <span className="text-destructive">*</span></Label>
                  <Input id="emergencyContactName" value={form.emergencyContactName ?? ""} onChange={(e) => updateForm({ emergencyContactName: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emergencyContactPhone">Emergency Contact Phone <span className="text-destructive">*</span></Label>
                  <Input id="emergencyContactPhone" value={form.emergencyContactPhone ?? ""} inputMode="numeric" maxLength={10} onChange={(e) => updateForm({ emergencyContactPhone: onlyDigits(e.target.value, 10) })} placeholder="10-digit number" />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="academic" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Academic Qualifications</AccordionTrigger>
            <AccordionContent className="space-y-4">
              {qualifications.map((row, i) => (
                <div key={row.id} className={`rounded-lg border p-3 space-y-3 ${row.sourceLabel ? "border-primary/40 bg-primary/5" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      {row.sourceLabel ? (
                        <>Required: {row.sourceLabel} <span className="text-destructive">*</span></>
                      ) : (
                        `Qualification ${i + 1}`
                      )}
                    </p>
                    {!row.sourceLabel && qualifications.filter((q) => !q.sourceLabel).length > 1 && (
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove qualification" onClick={() => removeQualificationRow(row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`qual-degree-${row.id}`}>Degree / Course</Label>
                      <Input id={`qual-degree-${row.id}`} value={row.degree} disabled={!!row.sourceLabel} onChange={(e) => updateQualificationRow(row.id, { degree: e.target.value })} placeholder="e.g. M.Tech" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`qual-institution-${row.id}`}>Institution</Label>
                      <Input id={`qual-institution-${row.id}`} value={row.institution} onChange={(e) => updateQualificationRow(row.id, { institution: e.target.value })} placeholder={institutionPlaceholderFor(row.sourceLabel)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`qual-year-${row.id}`}>Year of Passing</Label>
                      <Input id={`qual-year-${row.id}`} value={row.yearOfPassing} inputMode="numeric" maxLength={4} onChange={(e) => updateQualificationRow(row.id, { yearOfPassing: onlyDigits(e.target.value, 4) })} placeholder="e.g. 2020" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`qual-pct-${row.id}`}>Percentage / CGPA</Label>
                      <Input id={`qual-pct-${row.id}`} value={row.percentageOrCGPA} inputMode="decimal" onChange={(e) => updateQualificationRow(row.id, { percentageOrCGPA: decimalOnly(e.target.value) })} placeholder="e.g. 8.5" />
                    </div>
                  </div>
                  <FileUpload
                    accept=".pdf,.png,.jpg,.jpeg"
                    maxSizeMB={5}
                    onFileSelect={(file) => updateQualificationRow(row.id, { file })}
                    label={row.sourceLabel ? `Upload ${row.sourceLabel}` : "Upload Certificate"}
                  />
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={() => setQualifications((prev) => [...prev, newQualificationRow()])}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Qualification
              </Button>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="experience" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Work Experience</AccordionTrigger>
            <AccordionContent className="space-y-4">
              {experiences.map((row, i) => (
                <div key={row.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Experience {i + 1}</p>
                    {experiences.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove experience" onClick={() => removeExperienceRow(row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`exp-org-${row.id}`}>Organization</Label>
                      <Input id={`exp-org-${row.id}`} value={row.organization} onChange={(e) => updateExperienceRow(row.id, { organization: e.target.value })} placeholder="College / Company name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`exp-designation-${row.id}`}>Designation</Label>
                      <Input id={`exp-designation-${row.id}`} value={row.designation} onChange={(e) => updateExperienceRow(row.id, { designation: e.target.value })} placeholder="e.g. Assistant Professor" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`exp-from-${row.id}`}>From</Label>
                      <Input id={`exp-from-${row.id}`} type="month" value={row.fromDate} onChange={(e) => updateExperienceRow(row.id, { fromDate: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`exp-to-${row.id}`}>To</Label>
                      <Input id={`exp-to-${row.id}`} type="month" value={row.toDate} onChange={(e) => updateExperienceRow(row.id, { toDate: e.target.value })} placeholder="Leave blank if current" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`exp-resp-${row.id}`}>Responsibilities (optional)</Label>
                    <Textarea id={`exp-resp-${row.id}`} value={row.responsibilities ?? ""} onChange={(e) => updateExperienceRow(row.id, { responsibilities: e.target.value })} rows={2} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={() => setExperiences((prev) => [...prev, newExperienceRow()])}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Experience
              </Button>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="research" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Research Profile</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <p className="text-xs text-muted-foreground -mt-2">For teaching/research faculty roles — leave blank if not applicable</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstAuthorPublications">Publications (first/corresponding author)</Label>
                  <Input id="firstAuthorPublications" value={form.researchProfile?.firstAuthorPublications ?? ""} onChange={(e) => updateResearchProfile({ firstAuthorPublications: e.target.value })} placeholder="e.g. 5 (SCOPUS/WOS)" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publicationsQ1OrHighIF">Publications in Q1 or IF &gt; 4.0</Label>
                  <Input id="publicationsQ1OrHighIF" value={form.researchProfile?.publicationsQ1OrHighIF ?? ""} onChange={(e) => updateResearchProfile({ publicationsQ1OrHighIF: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="reviewPublications">Review Publications</Label>
                  <Input id="reviewPublications" value={form.researchProfile?.reviewPublications ?? ""} onChange={(e) => updateResearchProfile({ reviewPublications: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totalPublicationsInclCoAuthor">Total Publications (incl. co-author)</Label>
                  <Input id="totalPublicationsInclCoAuthor" value={form.researchProfile?.totalPublicationsInclCoAuthor ?? ""} onChange={(e) => updateResearchProfile({ totalPublicationsInclCoAuthor: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="patentsPublished">Patents Published</Label>
                  <Input id="patentsPublished" value={form.researchProfile?.patentsPublished ?? ""} onChange={(e) => updateResearchProfile({ patentsPublished: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patentsGranted">Patents Granted</Label>
                  <Input id="patentsGranted" value={form.researchProfile?.patentsGranted ?? ""} onChange={(e) => updateResearchProfile({ patentsGranted: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hIndex">H-Index (SCOPUS/WOS)</Label>
                  <Input id="hIndex" value={form.researchProfile?.hIndex ?? ""} onChange={(e) => updateResearchProfile({ hIndex: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="i10Index">i10-Index (SCOPUS/WOS)</Label>
                  <Input id="i10Index" value={form.researchProfile?.i10Index ?? ""} onChange={(e) => updateResearchProfile({ i10Index: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="fundingReceived">Funding Projects Received</Label>
                  <Input id="fundingReceived" value={form.researchProfile?.fundingReceived ?? ""} onChange={(e) => updateResearchProfile({ fundingReceived: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fundingApplied">Funding Projects Applied</Label>
                  <Input id="fundingApplied" value={form.researchProfile?.fundingApplied ?? ""} onChange={(e) => updateResearchProfile({ fundingApplied: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationalExposure">National Exposure (IIT/NIT/IIIT/CSIR labs) with joint publications</Label>
                <Textarea id="nationalExposure" value={form.researchProfile?.nationalExposure ?? ""} onChange={(e) => updateResearchProfile({ nationalExposure: e.target.value })} rows={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="internationalExposure">International Exposure with outcomes/joint publications</Label>
                <Textarea id="internationalExposure" value={form.researchProfile?.internationalExposure ?? ""} onChange={(e) => updateResearchProfile({ internationalExposure: e.target.value })} rows={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keyResearchSkills">Key Research Skills</Label>
                <Textarea id="keyResearchSkills" value={form.researchProfile?.keyResearchSkills ?? ""} onChange={(e) => updateResearchProfile({ keyResearchSkills: e.target.value })} rows={2} />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="relatives" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Relatives Working in the Society</AccordionTrigger>
            <AccordionContent className="space-y-4">
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
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove relative" onClick={() => removeRelativeRow(row.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor={`rel-name-${row.id}`}>Relative&apos;s Name</Label>
                          <Input id={`rel-name-${row.id}`} value={row.name} onChange={(e) => updateRelativeRow(row.id, { name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`rel-relationship-${row.id}`}>Relationship</Label>
                          <Input id={`rel-relationship-${row.id}`} value={row.relationship} onChange={(e) => updateRelativeRow(row.id, { relationship: e.target.value })} placeholder="e.g. Brother, Spouse" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor={`rel-location-${row.id}`}>Working Location</Label>
                          <Input id={`rel-location-${row.id}`} value={row.workingLocation} onChange={(e) => updateRelativeRow(row.id, { workingLocation: e.target.value })} placeholder="College / Department" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`rel-profession-${row.id}`}>Profession / Designation</Label>
                          <Input id={`rel-profession-${row.id}`} value={row.profession} onChange={(e) => updateRelativeRow(row.id, { profession: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`rel-experience-${row.id}`}>Experience</Label>
                        <Input id={`rel-experience-${row.id}`} value={row.experience} onChange={(e) => updateRelativeRow(row.id, { experience: e.target.value })} placeholder="e.g. 5 years" />
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full" onClick={() => setRelatives((prev) => [...prev, newRelativeRow()])}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Another Relative
                  </Button>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="professional" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Professional Details</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentEmployer">Current / Previous Employer</Label>
                <Input id="currentEmployer" value={form.currentEmployer ?? ""} onChange={(e) => updateForm({ currentEmployer: e.target.value })} placeholder="College / Institution name" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="totalExperienceYears">Total Experience (years)</Label>
                  <Input id="totalExperienceYears" type="number" min={0} value={form.totalExperienceYears ?? ""} onChange={(e) => updateForm({ totalExperienceYears: stripLeadingZeros(e.target.value) })} placeholder="3" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currentCTC">Current CTC (₹/annum)</Label>
                  <Input id="currentCTC" type="number" value={form.currentCTC ?? ""} onChange={(e) => updateForm({ currentCTC: stripLeadingZeros(e.target.value) })} placeholder="600000" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedCTC">Expected CTC (₹/annum)</Label>
                  <Input id="expectedCTC" type="number" value={form.expectedCTC ?? ""} onChange={(e) => updateForm({ expectedCTC: stripLeadingZeros(e.target.value) })} placeholder="700000" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="noticePeriod">Notice Period</Label>
                <Input id="noticePeriod" value={form.noticePeriod ?? ""} onChange={(e) => updateForm({ noticePeriod: e.target.value })} placeholder="e.g. Immediate / 30 days" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="references">References</Label>
                <Textarea id="references" value={form.references ?? ""} onChange={(e) => updateForm({ references: e.target.value })} rows={2} placeholder="Name, Designation, Contact (if any)" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="additionalInfo">Any additional information</Label>
                <Textarea id="additionalInfo" value={form.additionalInfo ?? ""} onChange={(e) => updateForm({ additionalInfo: e.target.value })} rows={2} placeholder="Publications, awards, patents, etc." />
              </div>
            </AccordionContent>
          </AccordionItem>

          {groupRequiredDocuments(requiredDocuments.filter((l) => !EDUCATION_DOCUMENT_TEMPLATES[l])).map(({ category, labels }) => (
            <AccordionItem key={category} value={`docs-${category}`} className="border rounded-lg bg-card px-4">
              <AccordionTrigger className="text-base font-semibold hover:no-underline">
                {category} <span className="text-destructive">*</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
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
              </AccordionContent>
            </AccordionItem>
          ))}

          <AccordionItem value="additional-docs" className="border rounded-lg bg-card px-4">
            <AccordionTrigger className="text-base font-semibold hover:no-underline">Additional Documents (Optional)</AccordionTrigger>
            <AccordionContent className="space-y-4">
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
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove document" onClick={() => removeCertRow(row.key)}>
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
            </AccordionContent>
          </AccordionItem>
        </Accordion>

          <Button type="submit" className="w-full">
            Submit My Details
          </Button>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit your details?"
        description="Once submitted, you won't be able to edit these details or documents yourself — please review everything before confirming. Contact the institution if you need to make changes afterward."
        confirmLabel="Confirm & Submit"
        onConfirm={handleSubmit}
        loading={saving}
      />
    </div>
  );
}
