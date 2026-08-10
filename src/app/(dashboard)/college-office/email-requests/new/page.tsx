"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { EmailCreationRequest, FacultyMember } from "@/types";

export default function NewEmailRequestPage() {
  const router = useRouter();
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [existingRequests, setExistingRequests] = useState<EmailCreationRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [facultyId, setFacultyId] = useState("");
  const [preferredEmail1, setPreferredEmail1] = useState("");
  const [preferredEmail2, setPreferredEmail2] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/faculty?status=ACTIVE").then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>),
      fetch("/api/college/email-requests").then((r) => r.json() as Promise<{ requests: EmailCreationRequest[] }>),
    ])
      .then(([facultyRes, requestsRes]) => {
        setFaculty(facultyRes.faculty ?? []);
        setExistingRequests(requestsRes.requests ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }))
      .finally(() => setIsLoading(false));
  }, []);

  // Eligible: active faculty with no official email yet, and no request already
  // pending for them (a completed one only lands here if officialEmail was never
  // written back — belt-and-braces, since officialEmail is the primary check).
  const pendingFacultyIds = useMemo(
    () => new Set(existingRequests.filter((r) => r.status === "PENDING").map((r) => r.facultyId)),
    [existingRequests]
  );
  const eligibleFaculty = useMemo(
    () => faculty.filter((f) => !f.officialEmail && !pendingFacultyIds.has(f.id)),
    [faculty, pendingFacultyIds]
  );
  const selected = eligibleFaculty.find((f) => f.id === facultyId);

  async function submit() {
    if (!facultyId) {
      toast({ variant: "destructive", title: "Select a faculty member" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/email-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId,
          preferredEmail1: preferredEmail1.trim() || undefined,
          preferredEmail2: preferredEmail2.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to submit request");
      }
      toast({ variant: "success", title: "Request sent to Webmaster" });
      router.push("/college-office/email-requests");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to submit request", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <PageHeader
        title="Request Official Email"
        description="Ask the Webmaster to provision an institutional email for a newly joined faculty member"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Faculty Member</Label>
            <Select value={facultyId} onValueChange={setFacultyId} disabled={isLoading}>
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading…" : "Select a faculty member…"} />
              </SelectTrigger>
              <SelectContent>
                {eligibleFaculty.length === 0 ? (
                  <SelectItem value="__none" disabled>No faculty awaiting an official email</SelectItem>
                ) : (
                  eligibleFaculty.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} — {f.designation} · {f.department}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground pt-1">
                Employee ID {selected.employeeId} · Login email {selected.collegeEmail}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Preferred Email 1 <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              type="email"
              value={preferredEmail1}
              onChange={(e) => setPreferredEmail1(e.target.value)}
              placeholder="e.g. dharani@college.edu"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Preferred Email 2 <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              type="email"
              value={preferredEmail2}
              onChange={(e) => setPreferredEmail2(e.target.value)}
              placeholder="e.g. dharani.n@college.edu"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            These are suggestions only — the Webmaster will confirm availability and may assign a different address.
          </p>

          <div className="flex gap-2 pt-2">
            <Button onClick={submit} loading={isSubmitting} disabled={!facultyId}>
              Send Request
            </Button>
            <Button variant="ghost" onClick={() => router.back()} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
