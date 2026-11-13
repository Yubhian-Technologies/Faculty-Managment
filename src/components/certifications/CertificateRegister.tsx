"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileDown, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { downloadCSV, toCSV } from "@/lib/utils/csv";
import type { IssuedCertificate } from "@/types";
import { downloadIssued, loadRegister, revokeCertificate } from "./configApi";

// The Certificate Register: every certificate issued, with its number, the student, who issued it and when, the
// fee receipt, and whether it was revoked. Searchable, exportable, each copy re-downloadable exactly as issued.

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function CertificateRegister({ canRevoke }: { canRevoke: boolean }) {
  const [rows, setRows] = useState<IssuedCertificate[] | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [revoking, setRevoking] = useState<IssuedCertificate | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setRows(await loadRegister()); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to load the register" }); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const types = useMemo(() => [...new Set((rows ?? []).map((r) => r.typeName))].sort(), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => (type === "ALL" || r.typeName === type)
      && (!q || [r.certificateNumber, r.studentName, r.studentRollNumber, r.studentDepartment, r.issuedByName].some((v) => v?.toLowerCase().includes(q))));
  }, [rows, query, type]);

  function exportCsv() {
    const header = ["Certificate No", "Certificate", "Student", "Regd. No", "Branch", "Issued on", "Issued by", "Fee receipt", "Status", "Revoked reason"];
    const data = shown.map((r) => [r.certificateNumber, r.typeName, r.studentName, r.studentRollNumber, r.studentDepartment, day(r.issuedAt), r.issuedByName, r.feeReceiptNo ?? "", r.revoked ? "Revoked" : "Valid", r.revoked?.reason ?? ""]);
    downloadCSV(toCSV([header, ...data]), "certificate-register.csv");
  }

  async function open(r: IssuedCertificate) {
    setBusy(r.id);
    try { await downloadIssued(r.id); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to open it" }); }
    finally { setBusy(""); }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy("revoke");
    try {
      await revokeCertificate(revoking.id, reason.trim());
      toast({ variant: "success", title: "Certificate revoked" });
      setRevoking(null); setReason(""); load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to revoke" }); }
    finally { setBusy(""); }
  }

  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Number, student, Regd. No…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All certificates</SelectItem>
            {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={shown.length === 0}><FileDown className="h-4 w-4 mr-1" /> Export</Button>
        <p className="text-sm text-muted-foreground sm:ml-auto">{shown.length} of {rows.length}</p>
      </div>

      {shown.length === 0 ? (
        <Card><EmptyState icon={<FileDown className="h-6 w-6" />} title={rows.length ? "Nothing matches" : "No certificates issued yet"} description="Issued certificates are listed here with their number." /></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="p-2.5">Number</th><th className="p-2.5">Certificate</th><th className="p-2.5">Student</th><th className="p-2.5">Issued</th><th className="p-2.5">Fee receipt</th><th className="p-2.5" /></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="p-2.5 font-mono text-xs whitespace-nowrap">{r.certificateNumber}{r.revoked && <Badge variant="destructive" className="ml-2">Revoked</Badge>}</td>
                    <td className="p-2.5">{r.typeName}</td>
                    <td className="p-2.5"><div>{r.studentName}</div><div className="text-xs text-muted-foreground">{r.studentRollNumber} · {r.studentDepartment}</div></td>
                    <td className="p-2.5 whitespace-nowrap"><div>{day(r.issuedAt)}</div><div className="text-xs text-muted-foreground">{r.issuedByName}</div></td>
                    <td className="p-2.5">{r.feeReceiptNo ?? "-"}</td>
                    <td className="p-2.5 whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => open(r)} loading={busy === r.id} title="Download"><Download className="h-4 w-4" /></Button>
                      {canRevoke && !r.revoked && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(r)}>Revoke</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!revoking} onOpenChange={(o) => { if (!o) { setRevoking(null); setReason(""); } }}
        title={`Revoke ${revoking?.certificateNumber ?? ""}?`}
        description="It stays in the register, marked revoked, and its QR check will say it was revoked. This can't be undone."
        confirmLabel="Revoke" variant="destructive" onConfirm={revoke} loading={busy === "revoke"} confirmDisabled={!reason.trim()}
      >
        <div className="space-y-1.5">
          <Label htmlFor="revoke-reason">Reason *</Label>
          <Textarea id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>
      </ConfirmDialog>
    </div>
  );
}
