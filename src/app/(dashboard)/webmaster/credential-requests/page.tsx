"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { KeyRound, UserPlus, Clock, CheckCircle2, Dices, Link2 } from "lucide-react";
import { FACULTY_ACCOUNT_REQUEST_STATUS_LABELS } from "@/types";
import type { FacultyAccountRequest, FacultyAccountRequestStatus } from "@/types";

type RequestRow = FacultyAccountRequest & { id: string };

type ExistingUser = { uid: string; name?: string; email?: string; phone?: string; role?: string };

const STATUS_BADGE: Record<FacultyAccountRequestStatus, string> = {
  SUBMITTED: "text-amber-700 border-amber-300 bg-amber-50",
  IN_PROGRESS: "text-blue-700 border-blue-300 bg-blue-50",
  CREDENTIALS_CREATED: "text-green-700 border-green-300 bg-green-50",
  COMPLETED: "text-muted-foreground",
};

const MIN_PASSWORD_LENGTH = 6; // Firebase Auth's own minimum

function suggestPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12);
}

export default function WebmasterCredentialRequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<{ name: string; password: string; employeeId?: string; email?: string } | null>(null);
  const [passwordDialogRequest, setPasswordDialogRequest] = useState<RequestRow | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [linkDialogRequest, setLinkDialogRequest] = useState<RequestRow | null>(null);
  const [linkUsers, setLinkUsers] = useState<ExistingUser[]>([]);
  const [linkUsersLoading, setLinkUsersLoading] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkSelectedUid, setLinkSelectedUid] = useState<string | null>(null);

  async function load() {
    try {
      const requests = await fetch("/api/college/faculty-account-requests")
        .then((r) => r.json() as Promise<{ requests: RequestRow[] }>)
        .then((d) => d.requests ?? []);
      // Completed requests still show briefly for confirmation, but the queue is
      // ordered so anything still needing action floats to the top.
      const order: Record<FacultyAccountRequestStatus, number> = { SUBMITTED: 0, IN_PROGRESS: 1, CREDENTIALS_CREATED: 2, COMPLETED: 3 };
      requests.sort((a, b) => order[a.status] - order[b.status]);
      setRequests(requests);
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Office raises new requests from a different session — refetch on refocus
    // so this queue doesn't sit stale.
    function onFocus() { void load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  async function transition(
    request: RequestRow,
    action: "START_REVIEW" | "CREATE_CREDENTIALS" | "LINK_EXISTING_ACCOUNT" | "COMPLETE",
    extra?: { password?: string; existingUid?: string }
  ) {
    setBusyId(request.id);
    try {
      const res = await fetch(`/api/college/faculty-account-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json() as { ok?: boolean; employeeId?: string; generatedPassword?: string; assignedEmail?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.generatedPassword) {
        toast({ variant: "success", title: "Account created", description: `Employee ID: ${data.employeeId ?? ""}` });
        setRevealedPassword({ name: request.candidateName, password: data.generatedPassword, employeeId: data.employeeId, email: data.assignedEmail });
      } else if (action === "LINK_EXISTING_ACCOUNT") {
        toast({ variant: "success", title: "Existing account linked", description: data.assignedEmail ? `Login: ${data.assignedEmail}` : undefined });
      } else if (action === "COMPLETE") {
        toast({ variant: "success", title: "Request completed", description: "Office has been notified." });
      } else {
        toast({ variant: "success", title: "Status updated" });
      }
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusyId(null);
    }
  }

  function openPasswordDialog(request: RequestRow) {
    setPasswordInput(suggestPassword());
    setPasswordDialogRequest(request);
  }

  async function submitCreateCredentials() {
    if (!passwordDialogRequest) return;
    if (passwordInput.length < MIN_PASSWORD_LENGTH) {
      toast({ variant: "destructive", title: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    const request = passwordDialogRequest;
    const password = passwordInput;
    setPasswordDialogRequest(null);
    await transition(request, "CREATE_CREDENTIALS", { password });
  }

  // Existing-account linking: lets Webmaster attach this request to a person's
  // already-existing login (re-hire, or someone who already holds another
  // staff account here) instead of always provisioning a brand-new one.
  function openLinkDialog(request: RequestRow) {
    setLinkDialogRequest(request);
    setLinkSearch("");
    setLinkSelectedUid(null);
    setLinkUsersLoading(true);
    fetch("/api/college/users?allDepts=true&includeAll=true")
      .then((r) => r.json() as Promise<{ users?: ExistingUser[] }>)
      .then((d) => setLinkUsers(d.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load accounts" }))
      .finally(() => setLinkUsersLoading(false));
  }

  async function submitLinkExisting() {
    if (!linkDialogRequest || !linkSelectedUid) return;
    const request = linkDialogRequest;
    setLinkDialogRequest(null);
    await transition(request, "LINK_EXISTING_ACCOUNT", { existingUid: linkSelectedUid });
  }

  const filteredLinkUsers = linkUsers.filter((u) => {
    const q = linkSearch.trim().toLowerCase();
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  const activeRequests = requests.filter((r) => r.status !== "COMPLETED");

  return (
    <div className="space-y-6">
      <PageHeader title="Faculty Account Requests" description="Review and provision the login for each candidate the office has requested an account for" />

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : activeRequests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <KeyRound className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No pending requests</p>
            <p className="text-sm text-muted-foreground mt-1">Requests appear here once College Office asks for a candidate&apos;s faculty account.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeRequests.map((request) => (
            <Card key={request.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{request.candidateName}</p>
                    <p className="text-xs text-muted-foreground">{request.designation} · {request.department}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Recommended: {request.officialEmail}
                      {request.assignedEmail && request.assignedEmail !== request.officialEmail ? ` — assigned: ${request.assignedEmail}` : ""}
                    </p>
                    {(request.alternateEmail1 || request.alternateEmail2) && (
                      <p className="text-xs text-muted-foreground">
                        Alternates: {[request.alternateEmail1, request.alternateEmail2].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className={`shrink-0 ${STATUS_BADGE[request.status]}`}>
                    {FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[request.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="space-y-1">
                  {request.history.map((h, i) => (
                    <p key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3 shrink-0" />
                      {FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[h.action]} by {h.byName} on {formatDate(h.at)}
                    </p>
                  ))}
                </div>
                {(request.status === "SUBMITTED" || request.status === "IN_PROGRESS") && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={busyId === request.id} onClick={() => openPasswordDialog(request)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Create Credentials
                    </Button>
                    <Button size="sm" variant="outline" loading={busyId === request.id} onClick={() => openLinkDialog(request)}>
                      <Link2 className="h-3.5 w-3.5 mr-1.5" />
                      Link Existing Account
                    </Button>
                  </div>
                )}
                {request.status === "CREDENTIALS_CREATED" && (
                  <Button size="sm" loading={busyId === request.id} onClick={() => void transition(request, "COMPLETE")}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Mark Completed &amp; Notify Office
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!passwordDialogRequest} onOpenChange={(o) => { if (!o) setPasswordDialogRequest(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Login Password</DialogTitle>
            <DialogDescription>
              Choose the password for <strong>{passwordDialogRequest?.candidateName}</strong>&rsquo;s login
              ({passwordDialogRequest?.assignedEmail || passwordDialogRequest?.officialEmail}), or use the suggested one below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Password</Label>
            <div className="flex gap-2">
              <Input
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                className="font-mono"
              />
              <Button type="button" variant="outline" size="icon" title="Suggest a random password" onClick={() => setPasswordInput(suggestPassword())}>
                <Dices className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogRequest(null)} disabled={busyId === passwordDialogRequest?.id}>Cancel</Button>
            <Button onClick={() => void submitCreateCredentials()} loading={busyId === passwordDialogRequest?.id}>Create Credentials</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkDialogRequest} onOpenChange={(o) => { if (!o) setLinkDialogRequest(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link Existing Account</DialogTitle>
            <DialogDescription>
              Attach <strong>{linkDialogRequest?.candidateName}</strong>&rsquo;s faculty record to a login they already
              have (e.g. a re-hire, or an account from another role) instead of creating a new one. No new password is
              created — they&rsquo;ll keep signing in the way they already do.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              placeholder="Search by name or email..."
            />
            <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
              {linkUsersLoading ? (
                <p className="text-sm text-muted-foreground p-3">Loading accounts...</p>
              ) : filteredLinkUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">No matching accounts found.</p>
              ) : (
                filteredLinkUsers.map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => setLinkSelectedUid(u.uid)}
                    className={`w-full text-left p-3 text-sm hover:bg-muted/50 transition-colors ${linkSelectedUid === u.uid ? "bg-primary/10" : ""}`}
                  >
                    <p className="font-medium">{u.name ?? "Unnamed"} {u.role ? <span className="text-xs text-muted-foreground font-normal">· {u.role}</span> : null}</p>
                    <p className="text-xs text-muted-foreground">{u.email}{u.phone ? ` · ${u.phone}` : ""}</p>
                  </button>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogRequest(null)} disabled={busyId === linkDialogRequest?.id}>Cancel</Button>
            <Button onClick={() => void submitLinkExisting()} disabled={!linkSelectedUid} loading={busyId === linkDialogRequest?.id}>
              Link This Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedPassword} onOpenChange={(o) => { if (!o) setRevealedPassword(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Account Created</DialogTitle>
            <DialogDescription>
              A login was created for <strong>{revealedPassword?.name}</strong>
              {revealedPassword?.employeeId ? ` (${revealedPassword.employeeId})` : ""}. College Office can also reveal this
              once on their own Faculty Credentials page - it will not be shown again after that.
            </DialogDescription>
          </DialogHeader>
          {revealedPassword?.email && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-mono select-all">{revealedPassword.email}</p>
            </div>
          )}
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-sm text-center select-all">
            {revealedPassword?.password}
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
