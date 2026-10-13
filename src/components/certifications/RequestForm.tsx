"use client";

import { useCallback, useEffect, useState } from "react";
import { FilePlus2, FileCheck2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { CERTIFICATE_PURPOSE_OPTIONS } from "@/lib/certifications/purposes";
import type { CertificateRequest } from "@/types";
import { listRequests, submitRequest } from "./api";
import { RequestList } from "./RequestList";

const ACTIVE_STATUSES: readonly string[] = ["IN_PROGRESS", "PENDING_ISSUANCE", "ISSUED"];
const CERTIFICATE_TYPES = [{ key: "NO_DUE", label: "No Due Certificate" }];

export function RequestForm() {
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<CertificateRequest | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [certificateType, setCertificateType] = useState("NO_DUE");
  const [purposeCode, setPurposeCode] = useState<string>(CERTIFICATE_PURPOSE_OPTIONS[0].code);
  const [purposeOther, setPurposeOther] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mine = await listRequests("mine");
      setExisting(mine.find((r) => ACTIVE_STATUSES.includes(r.status)) ?? null);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load your certificates" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setCertificateType("NO_DUE");
    setPurposeCode(CERTIFICATE_PURPOSE_OPTIONS[0].code);
    setPurposeOther("");
    setReason("");
  }

  async function handleSubmit() {
    if (purposeCode === "OTHER" && !purposeOther.trim()) {
      toast({ variant: "destructive", title: "Please describe the purpose" });
      return;
    }
    setSubmitting(true);
    try {
      const { alreadyExists, request } = await submitRequest(purposeCode, purposeOther.trim() || undefined, reason.trim() || undefined);
      setExisting(request);
      setDialogOpen(false);
      resetForm();
      toast({
        variant: alreadyExists ? "default" : "success",
        title: alreadyExists ? "You already have a request for this certificate" : "Request submitted",
      });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't submit your request" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      {existing ? (
        <div className="space-y-3">
          {/* Not tied to this one request - lives above its card since
              starting another request isn't an action scoped to it. */}
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Request
            </Button>
          </div>
          <RequestList request={existing} onCancelled={load} />
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-8 sm:p-10 flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <FileCheck2 className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h2 className="font-semibold text-lg">No certificate request in progress</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Start a request when you need one - it goes to your HOD, then Placement, Library, Hostel and PD, then the College Office.
              </p>
            </div>
            <Button size="lg" onClick={() => setDialogOpen(true)} className="gap-2">
              <FilePlus2 className="h-4 w-4" />
              Create New Request
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Certificate Request</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Certificate Type</Label>
              <Select value={certificateType} onValueChange={setCertificateType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERTIFICATE_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Purpose</Label>
              <Select value={purposeCode} onValueChange={setPurposeCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERTIFICATE_PURPOSE_OPTIONS.map((p) => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {purposeCode === "OTHER" && (
              <div className="space-y-1.5">
                <Label>Describe the purpose</Label>
                <Textarea value={purposeOther} onChange={(e) => setPurposeOther(e.target.value)} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Additional Notes (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? "Submitting…" : "Submit Request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
