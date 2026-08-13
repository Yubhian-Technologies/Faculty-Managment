"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Download, FileText, GraduationCap, User } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate, formatCurrency } from "@/lib/utils";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { downloadAppointmentLetterPdf } from "@/lib/pdf/downloadAppointmentLetter";
import { downloadCandidateProfilePdf } from "@/lib/pdf/downloadCandidateProfile";
import { CANDIDATE_STAGE_LABELS } from "@/types";
import type { Candidate, CandidateApplication, OfferLetter, AppointmentLetter } from "@/types";

// Consolidated read-only candidate profile shared by HOD, Principal/VP and
// College Office (see /candidate-profile in proxy.ts). Each section only renders
// once its underlying step is complete, so the page fills in as hiring progresses.
// Offer/appointment letter PDFs aren't stored files — they're regenerated on
// download from the stored letter record, matching how the office/principal pages do it.
export default function CandidateProfilePage() {
  const { id: candidateId } = useParams<{ id: string }>();
  const router = useRouter();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [offers, setOffers] = useState<OfferLetter[]>([]);
  const [appointments, setAppointments] = useState<AppointmentLetter[]>([]);
  const [college, setCollege] = useState<{ name: string; address: string }>({ name: "", address: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/college/candidates/${candidateId}`).then((r) => r.json() as Promise<{ candidate?: Candidate }>),
      fetch(`/api/college/candidate-applications?candidateId=${candidateId}`).then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch(`/api/college/offer-letters?candidateId=${candidateId}`).then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
      fetch(`/api/college/appointment-letters?candidateId=${candidateId}`).then((r) => r.json() as Promise<{ letters: AppointmentLetter[] }>).catch(() => ({ letters: [] })),
      collegeFetch("/api/college/info").then((r) => r.json() as Promise<{ name: string; address: string }>).catch(() => ({ name: "", address: "" })),
    ])
      .then(([candRes, appsRes, offersRes, apptsRes, infoRes]) => {
        if (!candRes.candidate) { setNotFound(true); return; }
        setCandidate(candRes.candidate);
        setApplications(appsRes.applications ?? []);
        setOffers((offersRes.letters ?? []).filter((o) => o.status !== "REJECTED"));
        setAppointments(apptsRes.letters ?? []);
        setCollege({ name: infoRes.name ?? "", address: infoRes.address ?? "" });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidate profile" }))
      .finally(() => setIsLoading(false));
  }, [candidateId]);

  const candidateAddress = candidate?.permanentAddress || candidate?.residenceAddress;

  async function downloadOffer(offer: OfferLetter) {
    setDownloading(`offer-${offer.id}`);
    try {
      await downloadOfferLetterPdf({
        candidateName: candidate?.name ?? offer.candidateName ?? "",
        candidateAddress,
        designation: offer.designation,
        department: offer.department,
        collegeName: college.name,
        collegeAddress: college.address,
        joiningDate: formatDate(offer.joiningDate as Parameters<typeof formatDate>[0]),
        letterDate: formatDate(new Date()),
        termsAndConditions: offer.termsAndConditions,
      }, candidate?.name ?? offer.id);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate offer letter", description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloading(null);
    }
  }

  async function downloadProfile() {
    if (!candidate) return;
    setDownloading("profile");
    try {
      const bio = candidate.bioData;
      await downloadCandidateProfilePdf({
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        collegeName: college.name,
        source: candidate.source,
        referralName: candidate.referralName,
        referralDescription: candidate.referralDescription,
        residenceAddress: candidate.residenceAddress,
        permanentAddress: candidate.permanentAddress,
        resumeUrl: candidate.resumeUrl,
        certificates: candidate.certificates,
        fatherName: bio?.fatherName,
        motherName: bio?.motherName,
        dateOfBirth: bio?.dateOfBirth,
        gender: bio?.gender,
        maritalStatus: bio?.maritalStatus,
        spouseName: bio?.spouseName,
        bloodGroup: bio?.bloodGroup,
        religion: bio?.religion,
        caste: bio?.caste,
        subCaste: bio?.subCaste,
        aadharNo: bio?.aadharNo,
        panNo: bio?.panNo,
        emergencyContactName: bio?.emergencyContactName,
        emergencyContactPhone: bio?.emergencyContactPhone,
        currentEmployer: bio?.currentEmployer,
        totalExperienceYears: bio?.totalExperienceYears,
        currentCTC: bio?.currentCTC,
        expectedCTC: bio?.expectedCTC,
        noticePeriod: bio?.noticePeriod,
        references: bio?.references,
        additionalInfo: bio?.additionalInfo,
        qualifications: bio?.qualifications,
        experiences: bio?.experiences,
        hasRelativesInSociety: bio?.hasRelativesInSociety,
        relatives: bio?.relatives,
        researchProfile: bio?.researchProfile,
        applications: applications.map((a) => ({
          position: a.position,
          department: a.department,
          currentStage: a.currentStage,
          status: a.status,
          negotiatedSalary: a.negotiatedSalary,
          dateOfJoining: a.dateOfJoining,
        })),
      }, candidate.name);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate candidate profile", description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloading(null);
    }
  }

  async function downloadAppointment(appt: AppointmentLetter) {
    setDownloading(`appt-${appt.id}`);
    try {
      await downloadAppointmentLetterPdf({
        candidateName: candidate?.name ?? appt.candidateName ?? "",
        candidateAddress: appt.candidateAddress || candidateAddress,
        designation: appt.designation,
        department: appt.department,
        collegeName: college.name,
        collegeAddress: college.address,
        joiningDate: formatDate(appt.joiningDate as Parameters<typeof formatDate>[0]),
        letterDate: formatDate(new Date()),
        termsAndConditions: appt.termsAndConditions,
      }, candidate?.name ?? appt.id);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate appointment letter", description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloading(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Candidate Profile" description="Loading..." />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (notFound || !candidate) {
    return (
      <div className="space-y-6">
        <Button variant="outline" size="sm" onClick={() => router.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        <div className="text-center py-12 text-muted-foreground">Candidate not found.</div>
      </div>
    );
  }

  const bio = candidate.bioData;
  const quals = bio?.qualifications ?? [];
  const certs = candidate.certificates ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={candidate.name}
        description={`${candidate.email}${candidate.phone ? ` · ${candidate.phone}` : ""}`}
        actions={
          <>
            <Button variant="outline" size="sm" loading={downloading === "profile"} onClick={() => void downloadProfile()}>
              <Download className="h-4 w-4 mr-1" /> Download Profile
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          </>
        }
      />

      {/* Bio-data — shown once the candidate submits the self-service form */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" /> Bio-Data</CardTitle></CardHeader>
        <CardContent>
          {!candidate.bioDataSubmitted && !bio ? (
            <p className="text-sm text-muted-foreground">Bio-data not submitted yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Field label="Father's Name" value={bio?.fatherName} />
              <Field label="Mother's Name" value={bio?.motherName} />
              <Field label="Date of Birth" value={bio?.dateOfBirth} />
              <Field label="Gender" value={bio?.gender} />
              <Field label="Marital Status" value={bio?.maritalStatus} />
              {bio?.maritalStatus === "Married" && <Field label="Spouse" value={bio?.spouseName} />}
              <Field label="Blood Group" value={bio?.bloodGroup} />
              <Field label="Category" value={bio?.caste} />
              <Field label="Aadhar No." value={bio?.aadharNo} />
              <Field label="PAN No." value={bio?.panNo} />
              <Field label="Emergency Contact" value={bio?.emergencyContactName} />
              <Field label="Emergency Phone" value={bio?.emergencyContactPhone} />
              <Field label="Current Employer" value={bio?.currentEmployer} />
              <Field label="Total Experience" value={bio?.totalExperienceYears} />
              <Field label="Current CTC" value={bio?.currentCTC} />
              <Field label="Expected CTC" value={bio?.expectedCTC} />
              <Field label="Notice Period" value={bio?.noticePeriod} />
              <Field label="Residence Address" value={candidate.residenceAddress} className="col-span-2 sm:col-span-3" />
              <Field label="Permanent Address" value={candidate.permanentAddress} className="col-span-2 sm:col-span-3" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Educational qualifications with per-degree certificate links */}
      {quals.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Educational Qualifications</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {quals.map((q) => (
              <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{q.degree}</p>
                  <p className="text-xs text-muted-foreground">{q.institution} · {q.yearOfPassing} · {q.percentageOrCGPA}</p>
                </div>
                {q.certificateUrl && (
                  <a href={q.certificateUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline shrink-0">
                    <ExternalLink className="h-3.5 w-3.5" /> Certificate
                  </a>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Resume + any other uploaded certificates */}
      {(certs.length > 0 || candidate.resumeUrl) && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Documents &amp; Certificates</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {candidate.resumeUrl && <DocLink label="Resume" url={candidate.resumeUrl} />}
            {certs.map((c, i) => <DocLink key={i} label={c.name} url={c.url} />)}
          </CardContent>
        </Card>
      )}

      {/* Offer / onboarding documents per hiring application */}
      <Card>
        <CardHeader><CardTitle className="text-base">Hiring &amp; Offer Documents</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not attached to any hiring request yet.</p>
          ) : (
            applications.map((app) => {
              const offer = offers.find((o) => o.batchId === app.batchId);
              const appt = appointments.find((a) => a.batchId === app.batchId);
              const ctc = offer?.ctcAnnual ?? app.negotiatedSalary;
              const doj = app.dateOfJoining ? formatDate(new Date(app.dateOfJoining))
                : offer ? formatDate(offer.joiningDate as Parameters<typeof formatDate>[0]) : null;
              const hasDocs = offer || appt || app.joiningLetterUrl;
              return (
                <div key={app.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{app.position}</p>
                      <p className="text-xs text-muted-foreground">{app.department} · {CANDIDATE_STAGE_LABELS[app.currentStage]}</p>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>

                  {(ctc != null || doj) && (
                    <div className="flex flex-wrap gap-6 text-sm">
                      {ctc != null && <div><p className="text-xs text-muted-foreground">CTC (Annual)</p><p className="font-medium">{formatCurrency(ctc)}</p></div>}
                      {doj && <div><p className="text-xs text-muted-foreground">Date of Joining</p><p className="font-medium">{doj}</p></div>}
                    </div>
                  )}

                  {hasDocs ? (
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      {offer && (
                        <Button size="sm" variant="outline" loading={downloading === `offer-${offer.id}`} onClick={() => void downloadOffer(offer)}>
                          <Download className="h-3.5 w-3.5 mr-1" /> Offer Letter
                        </Button>
                      )}
                      {app.joiningLetterUrl && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={app.joiningLetterUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" /> Joining Letter</a>
                        </Button>
                      )}
                      {appt && (
                        <Button size="sm" variant="outline" loading={downloading === `appt-${appt.id}`} onClick={() => void downloadAppointment(appt)}>
                          <Download className="h-3.5 w-3.5 mr-1" /> Appointment Letter
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground pt-2 border-t">No offer documents generated yet — they appear here as each step completes.</p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium break-words">{value}</p>
    </div>
  );
}

function DocLink({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
      <span className="font-medium">{label}</span>
      <span className="inline-flex items-center gap-1 text-primary shrink-0"><ExternalLink className="h-3.5 w-3.5" /> View</span>
    </a>
  );
}
