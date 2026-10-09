"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Search,
  UsersRound,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { useListUrlSync } from "@/hooks/useListUrlSync";
import { buildListUrl, readListString, withListBack } from "@/lib/listReturn";
import type { LocationStaffMember, LocationShift } from "@/types/locationStaff";

const LIST_PATH = "/location-dept-head/staff";

function LocationStaffRosterContent() {
  const { activeDept, activeDeptId } = useActiveLocationDept();
  // The search and filters this roster was showing when a profile was opened from
  // it, or when the page was refreshed - read once, on arrival; the page then
  // mirrors them back into the URL (listUrl below) and carries it to the profile
  // in `?back=` so its Back button returns to the same view.
  const searchParams = useSearchParams();

  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState(() => readListString(searchParams, "q", ""));
  const [selectedShift, setSelectedShift] = useState(() => readListString(searchParams, "shift", "ALL"));
  const [selectedRole, setSelectedRole] = useState(() => readListString(searchParams, "role", "ALL"));
  const listUrl = buildListUrl(LIST_PATH, { q: search, shift: selectedShift, role: selectedRole }, { shift: "ALL", role: "ALL" });
  useListUrlSync(listUrl, LIST_PATH);

  useEffect(() => {
    let isCancelled = false;
    if (!activeDeptId) {
      return;
    }

    Promise.all([
      fetch(`/api/location/staff?departmentId=${activeDeptId}&status=ALL`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          if (!isCancelled) setStaffList(d.staff ?? []);
        }),
      fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => {
          if (!isCancelled) setShifts(d.shifts ?? []);
        }),
    ])
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load staff roster" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeDeptId]);

  // Filter staff list
  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (selectedShift !== "ALL" && s.shiftId !== selectedShift) return false;
      if (selectedRole !== "ALL" && s.role !== selectedRole) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          s.name.toLowerCase().includes(q) ||
          s.contactNumber.includes(q) ||
          s.aadhaar.includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.payeeVoucher.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [staffList, selectedShift, selectedRole, search]);

  const uniqueRoles = useMemo(() => {
    return Array.from(new Set(staffList.map((s) => s.role).filter(Boolean)));
  }, [staffList]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link aria-label="Back" href="/location-dept-head">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Department Staff Roster</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>{activeDept?.name ?? "Department"}</span> · {staffList.length} Total Members
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            asChild
            size="sm"
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-sm"
          >
            <Link href="/location-dept-head/staff/new">
              <Plus className="h-4 w-4" />
              <span>Add Staff</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-card p-3 rounded-xl border shadow-xs">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, Aadhaar, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl"
          />
        </div>

        {/* Shift Filter */}
        <Select value={selectedShift} onValueChange={setSelectedShift}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="Filter by Shift" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Shifts</SelectItem>
            {shifts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.startTime} - {s.endTime})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Role Filter */}
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="h-9 text-xs rounded-xl">
            <SelectValue placeholder="Filter by Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            {uniqueRoles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Staff List Roster ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <UsersRound className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No staff members found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click &ldquo;Add Staff&rdquo; above to register members for {activeDept?.name ?? "this department"}.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredStaff.map((staff) => (
            <Link key={staff.id} href={withListBack(`/location-dept-head/staff/${staff.id}`, listUrl, LIST_PATH)} className="block">
              <Card className="border-border/80 shadow-xs hover:border-primary/40 transition-colors cursor-pointer">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-sm">
                        {staff.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                        ) : (
                          staff.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                            {staff.role}
                          </Badge>
                          {staff.status === "ACTIVE" ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Active" />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" title="Inactive" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          Father: {staff.fatherName} · Phone: {staff.contactNumber}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 flex-wrap">
                          <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">
                            Aadhaar: {staff.aadhaar.slice(0, 4)}••••{staff.aadhaar.slice(-4)}
                          </span>
                          <span>Payee: <strong className="text-foreground">{staff.payeeVoucher}</strong></span>
                          {staff.shiftName && (
                            <span className="text-primary font-medium">· Shift: {staff.shiftName}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0" tabIndex={-1} aria-label="View staff member">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LocationStaffRosterPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground animate-pulse">Loading staff...</div>}>
      <LocationStaffRosterContent />
    </Suspense>
  );
}
