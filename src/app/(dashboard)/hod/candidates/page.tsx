"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, UserCheck, UserX } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { Candidate } from "@/types";

type CandidateRow = Record<string, unknown> & Candidate;

export default function HODCandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/candidates")
      .then((r) => r.json() as Promise<{ candidates: CandidateRow[] }>)
      .then((d) => setCandidates(d.candidates ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function toggleShortlist(candidate: CandidateRow) {
    setToggling(candidate.id);
    const newVal = !candidate.isShortlisted;
    try {
      const res = await fetch(`/api/college/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isShortlisted: newVal }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: newVal ? "Candidate shortlisted" : "Removed from shortlist" });
      setCandidates((prev) =>
        prev.map((c) => c.id === candidate.id ? { ...c, isShortlisted: newVal } : c)
      );
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setToggling(null);
    }
  }

  async function deleteCandidate(candidate: CandidateRow) {
    if (!confirm(`Remove ${candidate.name as string}?`)) return;
    try {
      const res = await fetch(`/api/college/candidates/${candidate.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Candidate removed" });
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    } catch {
      toast({ variant: "destructive", title: "Failed to remove candidate" });
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
      key: "position",
      header: "Position",
      render: (row) => (
        <div>
          <p className="text-sm">{row.position as string}</p>
          <p className="text-xs text-muted-foreground">{row.department as string}</p>
        </div>
      ),
    },
    {
      key: "source",
      header: "Source",
      hideOnMobile: true,
      render: (row) => (
        <Badge variant="outline">
          {(row.source as string) === "CAREERS_PAGE" ? "Careers Page" : "Referral"}
        </Badge>
      ),
    },
    {
      key: "isShortlisted",
      header: "Shortlisted",
      render: (row) => (
        <Badge variant={(row.isShortlisted as boolean) ? "default" : "secondary"}>
          {(row.isShortlisted as boolean) ? "Yes" : "No"}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      render: (row) => <Badge variant="outline">{row.status as string}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            loading={toggling === (row.id as string)}
            onClick={(e) => { e.stopPropagation(); void toggleShortlist(row); }}
          >
            {(row.isShortlisted as boolean) ? (
              <><UserX className="h-4 w-4" /><span className="ml-1 hidden sm:inline">Unshortlist</span></>
            ) : (
              <><UserCheck className="h-4 w-4 text-green-600" /><span className="ml-1 hidden sm:inline text-green-600">Shortlist</span></>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); void deleteCandidate(row); }}
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
        description="Manage and shortlist candidates for interview"
        actions={
          <Button asChild>
            <Link href="/hod/candidates/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Candidate
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
        searchKeys={["name", "email", "position", "department"] as (keyof CandidateRow)[]}
        emptyTitle="No candidates yet"
        emptyDescription="Add candidates manually or they will appear from the careers page"
        emptyAction={
          <Button asChild>
            <Link href="/hod/candidates/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Candidate
            </Link>
          </Button>
        }
        csvFilename="candidates"
      />
    </div>
  );
}
