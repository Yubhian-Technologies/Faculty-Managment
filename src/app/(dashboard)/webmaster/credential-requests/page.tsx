"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { KeyRound, UserPlus, Clock } from "lucide-react";
import type { OfferLetter } from "@/types";

type OfferRow = OfferLetter & { id: string };

export default function WebmasterCredentialRequestsPage() {
  const [letters, setLetters] = useState<OfferRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<{ name: string; password: string; employeeId?: string } | null>(null);

  async function load() {
    try {
      const letters = await fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferRow[] }>).then((d) => d.letters ?? []);
      const pending = letters
        .filter((l) => l.credentialsRequestedAt && !l.credentialsFulfilledAt)
        .sort((a, b) => {
          const ta = (a.credentialsRequestedAt as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
          const tb = (b.credentialsRequestedAt as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
          return ta - tb; // oldest first
        });
      setLetters(pending);
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Office raises new credential requests from a different session —
    // refetch on refocus so this queue doesn't sit stale.
    function onFocus() { void load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  async function fulfill(letter: OfferRow) {
    setProvisioning(letter.id);
    try {
      const res = await fetch(`/api/college/offer-letters/${letter.id}/provision`, { method: "POST" });
      const data = await res.json() as { ok?: boolean; alreadyExists?: boolean; employeeId?: string; generatedPassword?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.alreadyExists) {
        toast({ title: "Faculty account already exists" });
      } else if (data.generatedPassword) {
        toast({ variant: "success", title: "Account created", description: `Employee ID: ${data.employeeId ?? ""}` });
        setRevealedPassword({ name: letter.candidateName ?? "the new faculty member", password: data.generatedPassword, employeeId: data.employeeId });
      }
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create account", description: err instanceof Error ? err.message : undefined });
    } finally {
      setProvisioning(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Credential Requests" description="Create the login for each candidate the office has requested credentials for" />

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : letters.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <KeyRound className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No pending requests</p>
            <p className="text-sm text-muted-foreground mt-1">Requests appear here once College Office asks for a candidate&apos;s login.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {letters.map((letter) => (
            <Card key={letter.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{letter.candidateName}</p>
                    <p className="text-xs text-muted-foreground">{letter.designation} · {letter.department}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      Requested by {letter.credentialsRequestedByName} on {formatDate(letter.credentialsRequestedAt as Parameters<typeof formatDate>[0])}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 shrink-0">Pending</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Button size="sm" loading={provisioning === letter.id} onClick={() => void fulfill(letter)}>
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  Create Account
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!revealedPassword} onOpenChange={(o) => { if (!o) setRevealedPassword(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Account Created</DialogTitle>
            <DialogDescription>
              A login was created for <strong>{revealedPassword?.name}</strong>
              {revealedPassword?.employeeId ? ` (${revealedPassword.employeeId})` : ""}. Share this temporary password with them securely - it will not be shown again.
            </DialogDescription>
          </DialogHeader>
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
