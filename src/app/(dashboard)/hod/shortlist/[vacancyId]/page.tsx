"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest, Candidate, CandidateApplication } from "@/types";

type Row = {
  applicationId: string;
  candidate: Candidate;
  isShortlisted: boolean;
};

function sourceLabel(c: Candidate): string {
  switch (c.source) {
    case "CAREERS_PAGE": return "Careers Page";
    case "ADVERTISEMENT": return "Advertisement";
    case "WALK_IN": return "Walk-in";
    case "REFERRAL": return `Referral${c.referralName ? ` · ${c.referralName}` : ""}`;
    default: return c.source;
  }
}

export default function ShortlistPage() {
  const { vacancyId } = useParams<{ vacancyId: string }>();
  const router = useRouter();
  const [vacancy, setVacancy] = useState<VacancyRequest | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    try {
      const [vacancies, applications, candidates] = await Promise.all([
        fetch("/api/college/vacancy-requests").then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>),
        fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      ]);
      setVacancy(vacancies.vacancyRequests?.find((v) => v.id === vacancyId) ?? null);
      const candidateMap = new Map((candidates.candidates ?? []).map((c) => [c.id, c]));
      const built = (applications.applications ?? [])
        .filter((a) => a.vacancyRequestId === vacancyId && a.status !== "REJECTED")
        .map((a) => {
          const candidate = candidateMap.get(a.candidateId);
          return candidate ? { applicationId: a.id, candidate, isShortlisted: a.isShortlisted } : null;
        })
        .filter((r): r is Row => r !== null);
      setRows(built);
      setChecked(Object.fromEntries(built.map((r) => [r.applicationId, r.isShortlisted])));
    } catch {
      toast({ variant: "destructive", title: "Failed to load candidates" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacancyId]);

  const dirty = rows.some((r) => checked[r.applicationId] !== r.isShortlisted);
  const shortlistedCount = rows.filter((r) => checked[r.applicationId]).length;

  async function handleSave() {
    const changed = rows.filter((r) => checked[r.applicationId] !== r.isShortlisted);
    if (changed.length === 0) return;
    setIsSaving(true);
    try {
      const results = await Promise.all(
        changed.map((r) =>
          fetch(`/api/college/candidate-applications/${r.applicationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isShortlisted: checked[r.applicationId] }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        toast({ variant: "destructive", title: "Some candidates could not be updated" });
      } else {
        toast({ variant: "success", title: "Shortlist saved" });
      }
      await load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.push("/hod/pipeline")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to pipeline
      </button>

      <PageHeader
        title="Shortlist Candidates"
        description={vacancy ? `${vacancy.position}${vacancy.department ? ` · ${vacancy.department}` : ""}` : "Tick the candidates to shortlist, then save."}
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-14 text-center">
          <UserCheck className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-semibold text-muted-foreground">No candidates attached to this hiring request yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {rows.map((r) => {
              const c = r.candidate;
              const isChecked = !!checked[r.applicationId];
              return (
                <label
                  key={r.applicationId}
                  htmlFor={`sl-${r.applicationId}`}
                  className={`flex gap-4 rounded-xl border-2 px-4 py-3 cursor-pointer transition-all ${
                    isChecked ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"
                  }`}
                >
                  <Checkbox
                    id={`sl-${r.applicationId}`}
                    checked={isChecked}
                    onCheckedChange={() => setChecked((prev) => ({ ...prev, [r.applicationId]: !prev[r.applicationId] }))}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{c.name}</p>
                      <Badge variant="outline" className="text-[11px]">{sourceLabel(c)}</Badge>
                      {c.bioDataSubmitted && (
                        <Badge variant="secondary" className="text-[11px]">Bio-data submitted</Badge>
                      )}
                      {isChecked && (
                        <Badge variant="default" className="text-[11px]">
                          <UserCheck className="h-3 w-3 mr-0.5" /> Shortlisted
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                      <p>{c.email}</p>
                      <p>{c.phone}</p>
                      {c.residenceAddress && <p className="sm:col-span-2">{c.residenceAddress}</p>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      {c.resumeUrl ? (
                        <a
                          href={c.resumeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" /> Resume
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">No resume</span>
                      )}
                      {(c.certificates?.length ?? 0) > 0 && (
                        <span className="text-xs text-muted-foreground">{c.certificates!.length} certificate(s)</span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-background/95 py-3 backdrop-blur">
            <p className="text-sm text-muted-foreground">
              {shortlistedCount} of {rows.length} shortlisted
            </p>
            <Button onClick={() => void handleSave()} loading={isSaving} disabled={!dirty}>
              Save Shortlist
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
