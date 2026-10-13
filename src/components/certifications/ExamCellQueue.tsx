"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { toDate } from "@/lib/utils";
import type { CertificateRequest } from "@/types";
import { listRequests, markExamCellIssued } from "./api";
import { StudentProfileDialog } from "./StudentProfileDialog";

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleDateString("en-IN") : "";
};

/** Requests whose PC/CMM task is pending - decoupled from the main
 *  approval flow, so this queue is independent of College Office's issuance queue. */
export function ExamCellQueue() {
  const [requests, setRequests] = useState<CertificateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await listRequests("exam-cell-queue"));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load the Exam Cell queue" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleMark(id: string) {
    setBusyId(id);
    try {
      await markExamCellIssued(id);
      toast({ variant: "success", title: "Marked PC & CMM issued" });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileCheck2 className="h-6 w-6" />}
          title="No requests currently"
          description="No PC/CMM requests are pending right now."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-semibold">{r.studentName} · {r.studentRollNumber}</p>
              <p className="text-xs text-muted-foreground">{r.studentDepartment} · Year {r.studentYear} · Section {r.studentSection}</p>
              <p className="text-xs text-muted-foreground mt-1">Submitted {when(r.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StudentProfileDialog requestId={r.id} studentName={r.studentName} />
              <Button onClick={() => handleMark(r.id)} disabled={busyId === r.id}>
                {busyId === r.id ? "Working…" : "Mark PC & CMM Issued"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
