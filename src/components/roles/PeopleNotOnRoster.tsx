"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS, type Department, type UserRole } from "@/types";

interface Person { uid: string; name?: string; role: string; seatRoles?: string[]; isActive?: boolean }

// Logins that teach (or may teach) but have no faculty profile yet: teaching
// faculty a location admin added before any department existed, and seat
// holders (a College Admin / Principal who also takes classes) who were added
// as office staff. Choosing a department and "Add to roster" opens the same
// profile form the Faculty page uses, linked to their existing login - and
// makes their primary role Faculty (their seats are unaffected).
export function PeopleNotOnRoster({ departments }: { departments: Department[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, string>>({});

  const { data: people = [] } = useQuery({
    queryKey: ["people-not-on-roster"],
    queryFn: async () => {
      const [u, f] = await Promise.all([
        fetch("/api/college/users?includeAll=true").then((r) => r.json() as Promise<{ users?: Person[] }>),
        fetch("/api/college/faculty").then((r) => r.json() as Promise<{ faculty?: { userUid?: string }[] }>),
      ]);
      const rostered = new Set((f.faculty ?? []).map((m) => m.userUid).filter(Boolean));
      return (u.users ?? []).filter((p) =>
        p.isActive !== false && !rostered.has(p.uid) &&
        (p.role === "PANEL_MEMBER" || (p.role === "COLLEGE_OFFICE" && (p.seatRoles?.length ?? 0) > 0)),
      );
    },
  });

  if (people.length === 0 || departments.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Not on the faculty roster yet</CardTitle>
        <p className="text-xs text-muted-foreground">
          Add anyone who teaches to a department&apos;s roster. Leave out office staff who don&apos;t teach.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {people.map((p) => {
          const dept = picked[p.uid] ?? "";
          const seats = (p.seatRoles ?? []).map((r) => ROLE_LABELS[r as UserRole] ?? r).join(", ");
          return (
            <div key={p.uid} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{p.name ?? p.uid}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[p.role as UserRole] ?? p.role}{seats ? ` · seats: ${seats}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={dept} onValueChange={(v) => setPicked((s) => ({ ...s, [p.uid]: v }))}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    {departments.filter((d) => d.isActive).map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!dept}
                  onClick={() => router.push(
                    `/principal/faculty/new?linkUid=${encodeURIComponent(p.uid)}&department=${encodeURIComponent(dept)}&name=${encodeURIComponent(p.name ?? "")}`,
                  )}
                >
                  Add to roster
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
