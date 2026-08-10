"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AttachToVacancyDialog } from "@/components/hiring/AttachToVacancyDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Candidate } from "@/types";

type CandidateRow = Record<string, unknown> & Candidate;

export default function HODCandidatesPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [attachTarget, setAttachTarget] = useState<CandidateRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CandidateRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Nothing is set synchronously: isLoading starts true and the rest happens
  // after an await, so calling this from an effect can't cascade renders.
  async function load() {
    try {
      const d = await fetch("/api/college/candidates")
        .then((r) => r.json() as Promise<{ candidates: CandidateRow[] }>);
      setCandidates(d.candidates ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load candidates" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void (async () => { await load(); })();
  }, []);

  async function deleteCandidate() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/candidates/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast({ variant: "success", title: "Candidate removed" });
      setCandidates((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Failed to remove candidate", description: e instanceof Error ? e.message : undefined });
    } finally {
      setIsDeleting(false);
    }
  }

  const columns: Column<CandidateRow>[] = [
    {
      key: "name",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name as string}</p>
          <p className="text-xs text-muted-foreground">{row.email as string}</p>
          <p className="text-xs text-muted-foreground">{row.phone as string}</p>
          {row.resumeUrl ? (
            <a
              href={row.resumeUrl as string}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" /> Resume
            </a>
          ) : (
            <span className="text-xs text-muted-foreground/60 mt-0.5 block">No resume</span>
          )}
        </div>
      ),
    },
    {
      key: "source",
      header: "Source",
      hideOnMobile: true,
      render: (row) => {
        const src = row.source as string;
        const label =
          src === "CAREERS_PAGE" ? "Careers Page" :
          src === "ADVERTISEMENT" ? "Advertisement" :
          src === "WALK_IN" ? "Walk-in" :
          src === "REFERRAL" ? `Referral${row.referralType ? ` (${(row.referralType as string) === "INTERNAL" ? "Int." : "Ext."})` : ""}` :
          src;
        return (
          <div>
            <Badge variant="outline">{label}</Badge>
            {src === "REFERRAL" && row.referralName && (
              <p className="text-xs text-muted-foreground mt-0.5">{row.referralName as string}</p>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setAttachTarget(row); }}
          >
            <Plus className="h-4 w-4" /><span className="ml-1 hidden sm:inline">Attach</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
            className="text-destructive hover:text-destructive"
          >
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="Manage candidates and attach them to hiring requests they're applying for"
        actions={
          <Button asChild>
            <Link href="/hod/candidates/new">
              <Plus className="h-4 w-4 mr-1" /> Add Candidate
            </Link>
          </Button>
        }
      />

      <DataTable
        data={candidates}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search candidates..."
        searchKeys={["name", "email"] as (keyof CandidateRow)[]}
        emptyTitle="No candidates yet"
        emptyDescription="Add a candidate to the pool, or they will appear automatically from the careers page"
        csvFilename="candidates"
        onRowClick={(row) => router.push(`/hod/candidates/${row.id as string}`)}
      />

      {attachTarget && (
        <AttachToVacancyDialog
          candidateId={attachTarget.id as string}
          candidateName={attachTarget.name as string}
          open={!!attachTarget}
          onOpenChange={(open) => { if (!open) setAttachTarget(null); }}
          onAttached={() => setAttachTarget(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Remove ${(deleteTarget?.name as string) ?? ""}?`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void deleteCandidate()}
        loading={isDeleting}
      />
    </div>
  );
}
