"use client";

import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RESEARCH_MODULES } from "@/lib/research/modules";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/types";

// R&D's landing page. Its job is to answer "what is waiting on me": every
// research module a faculty member or staff member can submit into, with the
// number of submissions sitting at PENDING verification.
//
// Counts come from the same list endpoints the module pages read, fetched in
// parallel off the shared RESEARCH_MODULES registry - so a module added there
// appears here automatically, and nothing has to be kept in step by hand.
// Every module uses `status === "PENDING"` for this, checked across all eleven.

const MODULES = Object.values(RESEARCH_MODULES);

export default function RAndDDashboard() {
  const user = useAuthStore((s) => s.user);

  const results = useQueries({
    queries: MODULES.map((m) => ({
      queryKey: ["r-and-d-pending", m.slug],
      queryFn: async () => {
        const res = await fetch(`/api/college/${m.apiPath}`);
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) throw new Error("failed");
        const list = (data[m.responseKey] ?? []) as { status?: string }[];
        return list.filter((r) => r.status === "PENDING").length;
      },
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  // A module whose fetch failed contributes 0 rather than breaking the page -
  // the other ten still tell R&D what needs looking at.
  const counts = results.map((r) => r.data ?? 0);
  const total = counts.reduce((sum, n) => sum + n, 0);

  const rows = MODULES.map((m, i) => ({ ...m, pending: counts[i], failed: results[i].isError }))
    // Only what actually needs verifying. A module with nothing outstanding is
    // not information a reviewer needs on this page - it just buries the ones
    // that do. A module whose fetch FAILED is kept, because "up to date" is
    // exactly what it must not be mistaken for.
    .filter((m) => m.pending > 0 || m.failed)
    // Most outstanding first, then alphabetically.
    .sort((a, b) => b.pending - a.pending || a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name ?? "there"}`}
        description={ROLE_LABELS.R_AND_D}
      />

      <Card>
        <CardContent className="p-4">
          {/* The count reads as a warning, not a neutral stat - these are
              submissions blocking someone else until they're looked at. */}
          {!isLoading && total > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-red-600 px-3 py-2.5 mb-4">
              <AlertTriangle className="h-4 w-4 text-white mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {total} record{total === 1 ? "" : "s"} awaiting your verification
                </p>
                <p className="text-xs text-white/85 mt-0.5">
                  Submitted by faculty and staff across {rows.filter((m) => m.pending > 0).length}{" "}
                  module{rows.filter((m) => m.pending > 0).length === 1 ? "" : "s"}.
                </p>
              </div>
            </div>
          )}

          <p className="text-sm font-semibold">Pending Verification</p>

          {isLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {MODULES.map((m) => (
                <div key={m.slug} className="rounded-lg border px-3 py-2.5">
                  <div className="h-3 w-28 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-10 rounded bg-muted animate-pulse mt-2" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Nothing awaiting verification</p>
              <p className="text-xs text-muted-foreground mt-1">
                New submissions from faculty and staff will show up here.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {rows.map((m) => (
                <Link key={m.slug} href={`/r-and-d/${m.slug}`}>
                  <div
                    className={`rounded-lg border px-3 py-2.5 h-full flex items-center justify-between gap-2 transition-colors hover:bg-muted/50 hover:border-primary/40 ${
                      m.pending > 0 ? "border-red-300" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{m.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.failed ? "Couldn't load" : `${m.pending} awaiting verification`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {m.pending > 0 && <Badge className="border-transparent bg-red-600 text-white hover:bg-red-600">{m.pending}</Badge>}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kept from before the pending summary was added - it explains why this
          account sees the modules it sees. */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Your account was created by the Principal. Access to specific modules is granted by your
          college&apos;s administration as needed.
        </CardContent>
      </Card>
    </div>
  );
}
