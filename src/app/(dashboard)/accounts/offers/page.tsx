"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Plus, FileText, Send, CheckCircle2, XCircle, Clock, Trash2, ChevronDown, ChevronUp, UserPlus } from "lucide-react";
import type { OfferLetter, HiringSalaryAgreement } from "@/types";

type OfferRow = OfferLetter & { id: string };

const STATUS_CONFIG: Record<string, { label: string; color: "default" | "secondary" | "outline" | "destructive"; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "secondary", icon: Clock },
  GENERATED: { label: "Generated", color: "outline", icon: FileText },
  SENT: { label: "Sent", color: "outline", icon: Send },
  ACCEPTED: { label: "Accepted", color: "default", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "destructive", icon: XCircle },
};

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function AccountsOffersPage() {
  const router = useRouter();
  const [letters, setLetters] = useState<OfferRow[]>([]);
  const [salaryMap, setSalaryMap] = useState<Record<string, HiringSalaryAgreement>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "SENT" | "ACCEPTED" | "REJECTED" | "DELETE" } | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [provisioning, setProvisioning] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const [lettersRes, salaryRes] = await Promise.all([
        fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferRow[] }>).then((d) => d.letters ?? []),
        fetch("/api/college/salary-records").then((r) => r.json() as Promise<{ records: HiringSalaryAgreement[] }>).then((d) => d.records ?? []),
      ]);

      setLetters(lettersRes);
      const map: Record<string, HiringSalaryAgreement> = {};
      for (const s of salaryRes) map[s.candidateId] = s;
      setSalaryMap(map);
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function provisionFaculty(letterId: string) {
    setProvisioning(letterId);
    try {
      const res = await fetch(`/api/college/offer-letters/${letterId}/provision`, { method: "POST" });
      const data = await res.json() as { ok?: boolean; alreadyExists?: boolean; employeeId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.alreadyExists) {
        toast({ title: "Faculty account already exists" });
      } else {
        toast({ variant: "success", title: "Faculty account created", description: `Employee ID: ${data.employeeId ?? ""}` });
      }
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create faculty account", description: err instanceof Error ? err.message : undefined });
    } finally {
      setProvisioning(null);
    }
  }

  async function handleAction() {
    if (!actionTarget) return;
    setIsActing(true);
    try {
      if (actionTarget.action === "DELETE") {
        await fetch(`/api/college/offer-letters/${actionTarget.id}`, { method: "DELETE" });
        toast({ title: "Offer letter deleted" });
      } else {
        await fetch(`/api/college/offer-letters/${actionTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: actionTarget.action }),
        });
        toast({ variant: "success", title: `Status updated to ${actionTarget.action.toLowerCase()}` });
      }
      setActionTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setIsActing(false);
    }
  }

  const counts = {
    draft: letters.filter((l) => l.status === "DRAFT").length,
    sent: letters.filter((l) => l.status === "SENT").length,
    accepted: letters.filter((l) => l.status === "ACCEPTED").length,
    rejected: letters.filter((l) => l.status === "REJECTED").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offer Letters"
        description="Generate and manage offer letters for selected candidates"
        actions={
          <Button onClick={() => router.push("/accounts/offers/new")}>
            <Plus className="h-4 w-4 mr-1" />
            New Offer Letter
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Draft", value: counts.draft, className: "text-muted-foreground" },
          { label: "Sent", value: counts.sent, className: "text-blue-600" },
          { label: "Accepted", value: counts.accepted, className: "text-green-600" },
          { label: "Rejected", value: counts.rejected, className: "text-red-600" },
        ].map(({ label, value, className }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${className}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Letters list */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : letters.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No offer letters yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create offer letters for candidates in the final decision stage.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {letters.map((letter) => {
            const cfg = STATUS_CONFIG[letter.status] ?? STATUS_CONFIG.DRAFT;
            const Icon = cfg.icon;
            const isExpanded = expandedId === letter.id;
            const salary = salaryMap[letter.candidateId];

            return (
              <Card key={letter.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : letter.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{letter.candidateName}</p>
                      <p className="text-xs text-muted-foreground">
                        {letter.designation} · {letter.department}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={cfg.color}>
                        <Icon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Joining Date</p>
                        <p className="font-medium">{formatDate(letter.joiningDate as Parameters<typeof formatDate>[0])}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Annual CTC</p>
                        <p className="font-medium">{rupees(letter.ctcAnnual)}</p>
                      </div>
                      {salary && (
                        <div>
                          <p className="text-xs text-muted-foreground">Monthly CTC</p>
                          <p className="font-medium">{rupees(salary.agreedMonthly)}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">Generated By</p>
                        <p className="font-medium">{letter.generatedBy}</p>
                      </div>
                      {letter.subjects && letter.subjects.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs text-muted-foreground">Subjects</p>
                          <p className="font-medium">{letter.subjects.join(", ")}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      {letter.status === "DRAFT" && (
                        <Button size="sm" onClick={() => setActionTarget({ id: letter.id, action: "SENT" })}>
                          <Send className="h-3.5 w-3.5 mr-1" />
                          Mark as Sent
                        </Button>
                      )}
                      {letter.status === "SENT" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            loading={provisioning === letter.id}
                            onClick={() => void provisionFaculty(letter.id)}
                          >
                            <UserPlus className="h-3.5 w-3.5 mr-1" />
                            Create Faculty Account
                          </Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setActionTarget({ id: letter.id, action: "ACCEPTED" })}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Mark Accepted
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setActionTarget({ id: letter.id, action: "REJECTED" })}>
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Mark Rejected
                          </Button>
                        </>
                      )}
                      {letter.status === "DRAFT" && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground ml-auto" onClick={() => setActionTarget({ id: letter.id, action: "DELETE" })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Action confirm */}
      <ConfirmDialog
        open={!!actionTarget}
        onOpenChange={(o) => { if (!o) setActionTarget(null); }}
        title={
          actionTarget?.action === "DELETE" ? "Delete Offer Letter?" :
          actionTarget?.action === "SENT" ? "Mark as Sent?" :
          actionTarget?.action === "ACCEPTED" ? "Mark as Accepted?" :
          "Mark as Rejected?"
        }
        description={
          actionTarget?.action === "DELETE" ? "This cannot be undone." :
          actionTarget?.action === "ACCEPTED" ? "This will mark the candidate as approved and finalize their hiring." :
          "Confirm this status change."
        }
        confirmLabel={
          actionTarget?.action === "DELETE" ? "Delete" :
          actionTarget?.action === "SENT" ? "Mark Sent" :
          actionTarget?.action === "ACCEPTED" ? "Mark Accepted" :
          "Mark Rejected"
        }
        variant={actionTarget?.action === "DELETE" || actionTarget?.action === "REJECTED" ? "destructive" : "default"}
        onConfirm={handleAction}
        loading={isActing}
      />
    </div>
  );
}
