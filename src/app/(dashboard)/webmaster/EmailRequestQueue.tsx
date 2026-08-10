"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Briefcase, RefreshCw, CheckCircle2, XCircle, Mail, Phone, CalendarDays, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { EmailCreationRequest } from "@/types";

type Row = EmailCreationRequest;

type Availability = "unchecked" | "checking" | "available" | "taken";

interface EmailRequestQueueProps {
  status?: "PENDING" | "COMPLETED" | "CANCELLED";
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function EmailRequestQueue({ status = "PENDING", limit, emptyTitle, emptyDescription }: EmailRequestQueueProps) {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const [assignedEmail, setAssignedEmail] = useState("");
  const [webmasterNotes, setWebmasterNotes] = useState("");
  const [availability, setAvailability] = useState<Availability>("unchecked");

  function load() {
    setIsLoading(true);
    fetch(`/api/college/email-requests?status=${status}`)
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load email requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  function expand(item: Row) {
    const isExpanded = expandedId === item.id;
    setExpandedId(isExpanded ? null : item.id);
    setAssignedEmail(isExpanded ? "" : (item.preferredEmail1 ?? ""));
    setWebmasterNotes("");
    setAvailability("unchecked");
  }

  async function checkAvailability(email: string) {
    if (!email.trim()) return;
    setAvailability("checking");
    try {
      const res = await fetch(
        `/api/college/email-requests/check-availability?email=${encodeURIComponent(email.trim())}`
      );
      const data = (await res.json()) as { available?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setAvailability(data.available ? "available" : "taken");
    } catch {
      setAvailability("unchecked");
      toast({ variant: "destructive", title: "Could not check availability" });
    }
  }

  async function createEmail(item: Row) {
    if (!assignedEmail.trim()) {
      toast({ variant: "destructive", title: "Enter the email to assign" });
      return;
    }
    setActingId(item.id);
    try {
      const res = await fetch(`/api/college/email-requests/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "FULFILL", assignedEmail: assignedEmail.trim(), webmasterNotes: webmasterNotes.trim() || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create email");
      toast({ variant: "success", title: "Official email created", description: "The requesting office has been notified." });
      setExpandedId(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create email", description: err instanceof Error ? err.message : undefined });
    } finally {
      setActingId(null);
    }
  }

  const refreshButton = (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
        <RefreshCw className="h-3.5 w-3.5 mr-1" />
        Refresh
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {refreshButton}
        {[1, 2].map((i) => <CardSkeleton key={i} />)}
      </div>
    );
  }

  const shown = limit ? requests.slice(0, limit) : requests;

  if (shown.length === 0) {
    return (
      <div className="space-y-3">
        {refreshButton}
        <EmptyState
          title={emptyTitle ?? "No requests"}
          description={emptyDescription ?? "Nothing here right now."}
          icon={<Mail className="h-8 w-8" />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {refreshButton}
      {shown.map((item) => {
        const isExpanded = expandedId === item.id;
        const isActingThis = actingId === item.id;

        return (
          <Card key={item.id}>
            <CardHeader className="pb-3 cursor-pointer" onClick={() => expand(item)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{item.candidateName}</span>
                    <Badge variant="secondary" className="text-xs">{item.designation}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5 shrink-0" />
                    {item.department}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.status === "COMPLETED" && item.assignedEmail && (
                    <Badge variant="completed" className="text-xs">{item.assignedEmail}</Badge>
                  )}
                  {item.status === "CANCELLED" && <Badge variant="rejected" className="text-xs">Cancelled</Badge>}
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 space-y-4">
                <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <p className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {item.personalEmail || "—"}</p>
                  <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {item.phone || "—"}</p>
                  <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> Joined {formatDate(item.joiningDate)}</p>
                  <p className="text-muted-foreground">Requested by {item.requestedByName} · {formatDate(item.requestedAt)}</p>
                </div>

                {(item.preferredEmail1 || item.preferredEmail2) && (
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Office-suggested emails</Label>
                    <div className="flex flex-wrap gap-2">
                      {[item.preferredEmail1, item.preferredEmail2].filter(Boolean).map((email) => (
                        <Button
                          key={email}
                          type="button"
                          size="sm"
                          variant={assignedEmail === email ? "default" : "outline"}
                          onClick={() => { setAssignedEmail(email as string); setAvailability("unchecked"); }}
                          disabled={item.status !== "PENDING"}
                        >
                          {email}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {item.status === "PENDING" ? (
                  <div className="space-y-3 rounded-md border p-3 bg-background">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Official Email to Assign</Label>
                      <div className="flex gap-2">
                        <Input
                          type="email"
                          value={assignedEmail}
                          onChange={(e) => { setAssignedEmail(e.target.value); setAvailability("unchecked"); }}
                          placeholder="e.g. dharani@college.edu"
                          disabled={isActingThis}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => checkAvailability(assignedEmail)}
                          loading={availability === "checking"}
                          disabled={!assignedEmail.trim() || isActingThis}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                          Check
                        </Button>
                      </div>
                      {availability === "available" && (
                        <p className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Available</p>
                      )}
                      {availability === "taken" && (
                        <p className="text-xs text-red-700 flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> Already in use — pick another address</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Textarea
                        value={webmasterNotes}
                        onChange={(e) => setWebmasterNotes(e.target.value)}
                        rows={2}
                        placeholder="Any note for the record..."
                        disabled={isActingThis}
                        className="resize-none text-sm"
                      />
                    </div>

                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      loading={isActingThis}
                      disabled={availability !== "available"}
                      onClick={() => createEmail(item)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Create Email
                    </Button>
                  </div>
                ) : (
                  item.webmasterNotes && (
                    <p className="text-xs text-muted-foreground">Note: {item.webmasterNotes}</p>
                  )
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
