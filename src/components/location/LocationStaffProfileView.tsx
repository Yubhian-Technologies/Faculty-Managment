"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { LocationConfig, LocationDepartment, LocationStaffMember } from "@/types/locationStaff";

interface LocationStaffProfileViewProps {
  staffId: string;
  backHref: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <dl className="divide-y divide-border/40 rounded-2xl border border-border/50">{children}</dl>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className={`text-right font-medium text-foreground break-words min-w-0 ${mono ? "font-mono tracking-wide" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

// Shared read-only staff profile page content - the single view both Location
// Staff Admin (location-staff-admin/staff/[id]) and Location Dept Head
// (location-dept-head/staff/[id]) render, instead of each keeping its own copy
// of the same fields in a dialog.
export function LocationStaffProfileView({ staffId, backHref }: LocationStaffProfileViewProps) {
  const [staff, setStaff] = useState<LocationStaffMember | null>(null);
  const [department, setDepartment] = useState<LocationDepartment | null>(null);
  const [gateName, setGateName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/staff/${staffId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => (d.staff as LocationStaffMember | undefined) ?? null),
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => (d.departments as LocationDepartment[] | undefined) ?? []),
      // Gates list is admin-only; dept heads get 403 and just see no gate name.
      fetch(`/api/location/locations`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ locations: [] })))
        .then((d) => (d.locations as LocationConfig[] | undefined) ?? []),
    ])
      .then(([staffData, departments, gates]) => {
        if (isCancelled) return;
        setStaff(staffData);
        setDepartment(departments.find((dep) => dep.id === staffData?.departmentId) ?? null);
        setGateName(gates.find((g) => g.id === staffData?.reportAtLocationId)?.name ?? staffData?.reportAtLocationName ?? "");
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load staff profile" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [staffId]);

  return (
    <div className="space-y-5 max-w-xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-1.5" /> Back</Link>
      </Button>

      {isLoading ? (
        <div className="h-96 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />
      ) : !staff ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
          <p className="font-bold text-foreground text-base">Staff member not found</p>
          <p className="text-xs text-muted-foreground mt-1">This personnel record may have been removed or reassigned.</p>
        </div>
      ) : (
        <Card className="rounded-3xl border-border/60 shadow-xs bg-card overflow-hidden">
          <CardContent className="p-6 sm:p-7 space-y-6">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="h-24 w-24 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden font-bold text-primary text-3xl">
                {staff.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                ) : (
                  staff.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold text-foreground">{staff.name}</h1>
                <p className="text-sm text-muted-foreground">{staff.role} · {staff.departmentName || "Unassigned"}</p>
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  <Badge className={staff.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-muted text-muted-foreground border-border/50"}>
                    {staff.status}
                  </Badge>
                  {staff.isDeptHead && (
                    <Badge className="bg-primary/15 text-primary border-primary/30 gap-1"><Shield className="h-3 w-3" /> Department Head</Badge>
                  )}
                </div>
              </div>
            </div>

            <Section title="Work">
              <Row label="Department" value={staff.departmentName || "Unassigned"} />
              <Row label="Supervising head" value={department?.headName} />
              <Row label="Shift" value={staff.shiftName || "Flexible"} />
              <Row label="Reports at gate" value={gateName} />
              <Row label="Date of joining" value={staff.dateOfJoining} />
            </Section>

            <Section title="Personal">
              <Row label="Contact" value={staff.contactNumber} />
              <Row label="Aadhaar" value={staff.aadhaar} mono />
              <Row label="Father's name" value={staff.fatherName} />
              <Row label="Address" value={staff.address} />
            </Section>

            <Section title="Payroll">
              <Row label="Payee" value={staff.payeeVoucher} />
              {staff.payeeType === "Account Payee" && (
                <>
                  <Row label="Account no." value={staff.accountNumber} mono />
                  <Row label="IFSC" value={staff.ifscCode} mono />
                  <Row label="Branch" value={staff.branchName} />
                </>
              )}
              <Row label="PF / ESI" value={`${staff.pfEnabled ? "PF" : "No PF"} · ${staff.esiEnabled ? "ESI" : "No ESI"}`} />
            </Section>

            {(staff.spouseGuardianName || staff.spouseGuardianPhone || staff.spouseGuardianAadhaar) && (
              <Section title="Spouse / Guardian">
                <Row label="Name" value={staff.spouseGuardianName} />
                <Row label="Phone" value={staff.spouseGuardianPhone} />
                <Row label="Aadhaar" value={staff.spouseGuardianAadhaar} mono />
              </Section>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
