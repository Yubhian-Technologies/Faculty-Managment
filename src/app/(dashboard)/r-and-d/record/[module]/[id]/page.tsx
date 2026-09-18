"use client";

import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResearchRecordDetails } from "@/components/research/ResearchRecordDetails";
import { RESEARCH_MODULES } from "@/lib/research/modules";
import { RESEARCH_FIELD_LABELS } from "@/lib/research/fieldLabels";
import {
  INDEX_LABELS, INDEX_REFERENCE_URLS, QUARTILE_REFERENCE_URL, IMPACT_FACTOR_REFERENCE_URL,
} from "@/lib/research/publicationReferences";
import type { PublicationIndex } from "@/types";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { UserRole } from "@/types";

// Full view of one Research & Innovation record, for every module.
//
// One page rather than eleven near-identical ones: the modules differ only in
// which endpoint they read and what their records are called, both of which
// RESEARCH_MODULES states. The fields themselves are rendered generically, so
// this needs no per-module field list to fall out of date.
//
// It reads the module's LIST endpoint and picks the record out of it, rather
// than a per-record GET: those exist for most modules but not all
// (research-profiles has no [id] route at all, citation-metrics keys by [uid]),
// and the lists are small. One shape that works everywhere beats nine that work
// and two special cases.
type RecordShape = Record<string, unknown> & {
  id?: string;
  ownerName?: string;
  ownerRole?: UserRole;
  ownerDesignation?: string;
  status?: string;
  rejectionReason?: string;
};


// Publications carry three fields a reviewer has to verify against an outside
// source, and the submission form shows the link for each. R&D gets the same
// links here, from the same shared constants, so checking a claim is one click
// rather than a search.
const PUBLICATION_REFERENCE_URLS: Record<string, string> = {
  quartile: QUARTILE_REFERENCE_URL,
  impactFactor: IMPACT_FACTOR_REFERENCE_URL,
};

// Each selected index is shown the way the submission form shows it - the name
// followed by its visible lookup URL. Making the badge itself the link (the
// first attempt) was indistinguishable from a plain badge: a reviewer had no
// way to tell there was a link there at all.
function IndexList({ value }: { value: unknown }) {
  const codes = (Array.isArray(value) ? value : [value]).filter((c) => c !== null && c !== undefined && c !== "");
  if (codes.length === 0) return null;
  return (
    <div className="space-y-0.5 pt-0.5">
      {codes.map((code, i) => {
        const key = String(code) as PublicationIndex;
        const href = INDEX_REFERENCE_URLS[key];
        const label = INDEX_LABELS[key] ?? String(code);
        return (
          <div key={i} className="flex flex-wrap items-baseline gap-1.5">
            <span>{label}</span>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline break-all"
              >
                ({href})
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PUBLICATION_RENDERERS: Record<string, (value: unknown) => React.ReactNode> = {
  indexedIn: (value) => <IndexList value={value} />,
  // The legacy flat copy of the same thing (see deriveFlatFields) - shown with
  // the same link so the two don't contradict each other on one page.
  indexing: (value) => <IndexList value={value} />,
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  APPROVED: "default",
  PENDING: "outline",
  REJECTED: "destructive",
};

export default function ResearchRecordPage({
  params,
}: {
  params: Promise<{ module: string; id: string }>;
}) {
  const { module: moduleSlug, id } = use(params);
  const router = useRouter();
  const config = RESEARCH_MODULES[moduleSlug];

  // react-query rather than a fetch-in-an-effect, matching the other pages that
  // read these endpoints - and it keeps this file clear of the
  // setState-directly-in-an-effect the React Compiler lint rejects.
  const { data: record = null, isLoading, isError } = useQuery({
    queryKey: ["research-record", moduleSlug, id],
    enabled: !!config,
    queryFn: async () => {
      const res = await fetch(`/api/college/${config!.apiPath}`);
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error("Failed to load this record");
      const list = (data[config!.responseKey] ?? []) as RecordShape[];
      return list.find((r) => r.id === id) ?? null;
    },
  });

  useEffect(() => {
    if (isError) toast({ variant: "destructive", title: "Failed to load this record" });
  }, [isError]);

  if (!config) {
    return <p className="text-sm text-muted-foreground">Unknown research module.</p>;
  }

  // createdAt is hidden from the field list (it's plumbing, not something the
  // submitter typed) but is worth showing once, next to the status.
  const createdAt = record?.createdAt as { toDate?: () => Date; _seconds?: number } | undefined;
  const createdDate = typeof createdAt?.toDate === "function" ? createdAt.toDate()
    : typeof createdAt?._seconds === "number" ? new Date(createdAt._seconds * 1000)
      : null;
  const submittedOn = createdDate
    ? createdDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  const ownerLine = record
    ? [
        record.ownerName,
        record.ownerDesignation ?? (record.ownerRole ? ROLE_LABELS[record.ownerRole] : undefined),
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={config.label}
        description={ownerLine ? `Submitted by ${ownerLine}` : "Full submitted record"}
        actions={
          <Button variant="outline" onClick={() => router.push(`/r-and-d/${config.slug}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        // Skeleton in the same grid shape the fields land in, so the layout
        // doesn't jump once they arrive.
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="h-2.5 w-24 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-32 rounded bg-muted animate-pulse mt-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !record ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium">This record no longer exists</p>
            <p className="text-xs text-muted-foreground mt-1">
              It may have been deleted after this page was opened.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Status sits in its own strip rather than among the fields - it's
              the thing a reviewer checks first, and a rejection reason needs
              room to be read. */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {record.status && (
                  <Badge variant={STATUS_VARIANT[record.status] ?? "secondary"}>
                    {record.status.charAt(0) + record.status.slice(1).toLowerCase()}
                  </Badge>
                )}
                {record.status === "REJECTED" && record.rejectionReason && (
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Reason:</span> {String(record.rejectionReason)}
                  </span>
                )}
              </div>
              {submittedOn && (
                <span className="text-xs text-muted-foreground">Submitted {submittedOn}</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <ResearchRecordDetails
                record={record}
                labels={RESEARCH_FIELD_LABELS[moduleSlug]}
                renderers={moduleSlug === "publications" ? PUBLICATION_RENDERERS : undefined}
                referenceUrls={moduleSlug === "publications" ? PUBLICATION_REFERENCE_URLS : undefined}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
