"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Send, Inbox, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import type { FacultyAssignmentRequest, FacultyMember } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

function statusBadge(status: FacultyAssignmentRequest["status"]) {
  if (status === "ALLOCATED") return <Badge variant="approved">Allocated</Badge>;
  if (status === "DECLINED") return <Badge variant="rejected">Declined</Badge>;
  return <Badge variant="modified">Pending</Badge>;
}

export default function AssignmentRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<FacultyAssignmentRequest[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [pickedFaculty, setPickedFaculty] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [reqRes, facRes] = await Promise.all([
        fetch("/api/college/faculty-assignment-requests"),
        // scope=own: you're lending one of YOUR faculty out, not a managed
        // branch's - see college/faculty/route.ts.
        fetch("/api/college/faculty?status=ACTIVE&scope=own"),
      ]);
      const reqData = await reqRes.json() as { requests: FacultyAssignmentRequest[] };
      const facData = await facRes.json() as { faculty: FacultyMember[] };
      setRequests(reqData.requests ?? []);
      setFaculty(facData.faculty ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load assignment requests" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Awaited in a wrapper so load()'s setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
  }, [load]);

  const incoming = requests.filter((r) => r.requestedBy !== user?.uid);
  const outgoing = requests.filter((r) => r.requestedBy === user?.uid);

  async function handleAllocate(reqId: string) {
    const facultyId = pickedFaculty[reqId];
    if (!facultyId) {
      toast({ variant: "destructive", title: "Pick a faculty member first" });
      return;
    }
    setBusyId(reqId);
    try {
      const res = await fetch(`/api/college/faculty-assignment-requests/${reqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allocate", facultyId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to allocate");
      toast({ variant: "success", title: "Faculty assigned - the requester can now place it on their timetable" });
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to allocate" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(reqId: string) {
    setBusyId(reqId);
    try {
      const res = await fetch(`/api/college/faculty-assignment-requests/${reqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Request declined" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to decline" });
    } finally {
      setBusyId(null);
    }
  }

  const visible = tab === "incoming" ? incoming : outgoing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assignment Requests"
        description="Ask another department to lend a faculty member for a subject you can't staff yourself, or fulfil requests sent to your department"
      />

      <SegmentedTabs
        value={tab}
        onChange={(k) => setTab(k as "incoming" | "outgoing")}
        options={[
          { key: "incoming", label: `Requests to us (${incoming.length})` },
          { key: "outgoing", label: `Our requests (${outgoing.length})` },
        ]}
      />

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={tab === "incoming" ? <Inbox className="h-8 w-8" /> : <Send className="h-8 w-8" />}
          title={tab === "incoming" ? "No requests to your department yet" : "You haven't requested any faculty yet"}
          description={
            tab === "incoming"
              ? "When another department needs a faculty member for a shared subject, it'll show up here."
              : "Send one from the Teaching Assignments page when your own faculty pool has nobody free for a subject."
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium text-sm">
                      {r.subjectName} <span className="text-muted-foreground">({r.subjectCode})</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.courseName} · {ordinalYear(r.year)} · Section {r.sectionName} · {r.hoursPerWeek} hrs/wk
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tab === "incoming"
                        ? `${r.requestedByName} (${r.requestingDepartment}) asked ${r.targetDepartmentName} to lend a faculty member`
                        : `Sent to ${r.targetDepartmentName}`}
                    </p>
                  </div>
                  {statusBadge(r.status)}
                </div>

                {r.status === "ALLOCATED" && (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-muted-foreground">
                      Allocated: <span className="text-foreground font-medium">{r.allocatedFacultyName}</span>
                      {tab === "outgoing" && " - the lending department places its weekly periods and will notify you once ready"}
                    </p>
                    {/* Only the lending HOD places these periods now - they
                        picked the faculty and know their availability, and
                        the Timetable page's own "Add a subject" no longer
                        offers this subject to the requester (see
                        pickableAssignments there), so showing this link on
                        the outgoing/requester side would just be a dead end. */}
                    {tab === "incoming" && (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          href={`/hod/timetable/${r.courseId}/${r.year}/${r.sectionId}?courseName=${encodeURIComponent(r.courseName)}&sectionName=${encodeURIComponent(r.sectionName)}&requestId=${r.id}&assignmentId=${r.teachingAssignmentId ?? ""}`}
                        >
                          <CalendarDays className="h-3.5 w-3.5 mr-1.5" />Place on timetable
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
                {r.status === "DECLINED" && r.declineReason && (
                  <p className="text-xs text-muted-foreground">Reason: {r.declineReason}</p>
                )}

                {tab === "incoming" && r.status === "PENDING" && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Select
                      value={pickedFaculty[r.id] ?? ""}
                      onValueChange={(v) => setPickedFaculty((p) => ({ ...p, [r.id]: v }))}
                    >
                      <SelectTrigger className="w-64"><SelectValue placeholder={faculty.length ? "Select faculty" : "No faculty in your department"} /></SelectTrigger>
                      <SelectContent>
                        {faculty.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" loading={busyId === r.id} onClick={() => void handleAllocate(r.id)}>
                      Allocate
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void handleDecline(r.id)}>
                      Decline
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
