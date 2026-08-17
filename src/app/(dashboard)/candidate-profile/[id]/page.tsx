"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Download, FileText, GraduationCap, User, Briefcase, Users, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate, formatCurrency } from "@/lib/utils";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { downloadAppointmentLetterPdf } from "@/lib/pdf/downloadAppointmentLetter";
import { downloadCandidateProfilePdf } from "@/lib/pdf/downloadCandidateProfile";
import { useAuth } from "@/hooks/useAuth";
import { CANDIDATE_STAGE_LABELS, ROLE_LABELS, FACULTY_ACCOUNT_REQUEST_STATUS_LABELS, BATCH_PHASE_LABELS } from "@/types";
import type {
  Candidate, CandidateApplication, OfferLetter, AppointmentLetter,
  VacancyRequest, HiringBatch, PanelFeedback, FacultyAccountRequest,
} from "@/types";

// Consolidated read-only candidate profile shared by HOD, Principal/VP and
// College Office (see /candidate-profile in proxy.ts). Each section only renders
// once its underlying step is complete, so the page fills in as hiring progresses.
// Offer/appointment letter PDFs aren't stored files — they're regenerated on
// download from the stored letter record, matching how the office/principal pages do it.
export default function CandidateProfilePage() {
  const { id: candidateId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [offers, setOffers] = useState<OfferLetter[]>([]);
  const [appointments, setAppointments] = useState<AppointmentLetter[]>([]);
  const [college, setCollege] = useState<{ name: string; address: string }>({ name: "", address: "" });
  const [vacancyRequests, setVacancyRequests] = useState<VacancyRequest[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [accountRequests, setAccountRequests] = useState<FacultyAccountRequest[]>([]);
  const [panelFeedback, setPanelFeedback] = useState<PanelFeedback[]>([]);
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
      // Not scoped to this candidate server-side (these list endpoints don't take
      // a candidateId filter) - filtered client-side below instead, same pattern
      // the office/HOD list pages already use for these same endpoints.
      fetch(`/api/college/vacancy-requests`).then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>).catch(() => ({ vacancyRequests: [] })),
      fetch(`/api/college/hiring-batches`).then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).catch(() => ({ batches: [] })),
      fetch(`/api/college/faculty-account-requests`).then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>).catch(() => ({ requests: [] })),
    ])
      .then(([candRes, appsRes, offersRes, apptsRes, infoRes, vacRes, batchesRes, acctRes]) => {
        if (!candRes.candidate) { setNotFound(true); return; }
        setCandidate(candRes.candidate);
        setApplications(appsRes.applications ?? []);
        setOffers((offersRes.letters ?? []).filter((o) => o.status !== "REJECTED"));
        setAppointments(apptsRes.letters ?? []);
        setCollege({ name: infoRes.name ?? "", address: infoRes.address ?? "" });
        setVacancyRequests(vacRes.vacancyRequests ?? []);
        setBatches(batchesRes.batches ?? []);
        setAccountRequests((acctRes.requests ?? []).filter((r) => r.candidateId === candidateId));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidate profile" }))
      .finally(() => setIsLoading(false));
  }, [candidateId]);

  // Panel feedback lives in a per-batch subcollection, keyed by batchId - only
  // fetchable once we know which batch(es) this candidate's application(s)
  // actually reached, hence the separate effect chained off `applications`.
  // Wrapped in an async IIFE so no setState call is reachable synchronously
  // from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => {
      const batchIds = Array.from(new Set(applications.map((a) => a.batchId).filter((b): b is string => !!b)));
      if (batchIds.length === 0) { setPanelFeedback([]); return; }
      const results = await Promise.all(
        batchIds.map((batchId) =>
          fetch(`/api/college/panel-feedback?batchId=${batchId}&candidateId=${candidateId}`)
            .then((r) => (r.ok ? (r.json() as Promise<{ feedback: PanelFeedback[] }>) : { feedback: [] }))
            .catch((): { feedback: PanelFeedback[] } => ({ feedback: [] }))
        )
      );
      setPanelFeedback(results.flatMap((r) => r.feedback ?? []));
    })();
  }, [applications, candidateId]);

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
        generatedByName: user?.name ?? "College Office",
        generatedByRole: user?.role ? ROLE_LABELS[user.role] : undefined,
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

      {/* Stage 1 — the hiring request(s) this candidate is/was attached to */}
      {applications.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Briefcase className="h-4 w-4" /> Vacancy Request</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {applications.map((app) => {
              const vacancy = vacancyRequests.find((v) => v.id === app.vacancyRequestId);
              if (!vacancy) return null;
              return (
                <div key={app.id} className="rounded-lg border p-4 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{vacancy.position}</p>
                      <p className="text-xs text-muted-foreground">
                        {vacancy.department} · {vacancy.qualification || "Qualification not set"} · {vacancy.requiredCount} position{vacancy.requiredCount > 1 ? "s" : ""}
                      </p>
                    </div>
                    <StatusBadge status={vacancy.status} />
                  </div>
                  {vacancy.justification && (
                    <div>
                      <p className="text-xs text-muted-foreground">Justification</p>
                      <p className="whitespace-pre-wrap">{vacancy.justification}</p>
                    </div>
                  )}
                  {vacancy.hodJustification && (
                    <div>
                      <p className="text-xs text-muted-foreground">HOD&apos;s Justification</p>
                      <p className="whitespace-pre-wrap">{vacancy.hodJustification}</p>
                    </div>
                  )}
                  {vacancy.principalResponse && (
                    <div className="pt-2 border-t flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Principal Decision:</span>
                      <StatusBadge status={vacancy.principalResponse.action} />
                      {vacancy.principalResponse.reason && <span className="text-xs">{vacancy.principalResponse.reason}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

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

      {/* Stage 7 — interview logistics + panel scores, once the candidate reached a batch */}
      {applications.some((a) => a.batchId) && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Interview &amp; Panel Feedback</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {applications.filter((a) => a.batchId).map((app) => {
              const batch = batches.find((b) => b.id === app.batchId);
              const feedbackForBatch = panelFeedback.filter((f) => f.batchId === app.batchId);
              return (
                <div key={app.id} className="rounded-lg border p-4 space-y-3 text-sm">
                  {batch && (
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <Field label="Interview Date" value={formatDate(batch.interviewDate)} />
                      <Field label="Venue" value={batch.interviewVenue} />
                      <Field label="Coordinator" value={batch.coordinatorName} />
                      <Field label="Batch Phase" value={BATCH_PHASE_LABELS[batch.currentPhase]} />
                    </div>
                  )}
                  {feedbackForBatch.length === 0 ? (
                    <p className="text-xs text-muted-foreground pt-2 border-t">No panel feedback submitted yet.</p>
                  ) : (
                    <div className="space-y-2 pt-2 border-t">
                      {feedbackForBatch.map((f) => {
                        const panelAvg = f.panelScores
                          ? (f.panelScores.subjectKnowledge + f.panelScores.presentationSkills + f.panelScores.research + f.panelScores.specificAttributes + f.panelScores.others) / 5
                          : null;
                        return (
                          <div key={f.id} className="flex items-center justify-between gap-3">
                            <p className="font-medium">{f.panelName}</p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {f.demoOverallScore != null && <span>Demo: {f.demoOverallScore}/10</span>}
                              {panelAvg != null && <span>Panel: {panelAvg.toFixed(1)}/10</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* Stages 13–14 — faculty account request through the Webmaster, and its
          audit trail. Never shows the one-time password itself - that stays
          gated behind the Reveal Credentials flow on the Office's own page. */}
      {accountRequests.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Faculty Account &amp; Credentials</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {accountRequests.map((r) => (
              <div key={r.id} className="rounded-lg border p-4 space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{r.designation} · {r.department}</p>
                    <p className="text-xs text-muted-foreground">
                      Recommended: {r.officialEmail}
                      {r.assignedEmail && r.assignedEmail !== r.officialEmail ? ` (assigned: ${r.assignedEmail})` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">{FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[r.status]}</Badge>
                </div>
                {r.history?.length > 0 && (
                  <div className="space-y-1 pt-2 border-t">
                    {r.history.map((h, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[h.action]} — {h.byName} ({ROLE_LABELS[h.byRole] ?? h.byRole})</span>
                        <span className="shrink-0">{formatDate(h.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
