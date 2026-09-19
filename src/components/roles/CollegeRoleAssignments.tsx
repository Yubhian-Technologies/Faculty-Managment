"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RoleAssignmentsPage } from "@/components/roles/RoleAssignmentsPage";
import { toast } from "@/hooks/useToast";

interface CollegeOption { id: string; name?: string }

// Role Assignments for Super Admin / Management / the location's
// Administration - none of whom belong to a college, so they pick which
// college's seats to manage first. Same screen the college's own Principal /
// College Admin uses (RoleAssignmentsPage).
export function CollegeRoleAssignments({ collegesUrl }: { collegesUrl: string }) {
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  // Deep link from a college's "Role Assignments" button (?collegeId=...).
  const [collegeId, setCollegeId] = useState(useSearchParams().get("collegeId") ?? "");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(collegesUrl)
      .then((r) => r.json() as Promise<{ colleges?: CollegeOption[] }>)
      .then((d) => {
        const list = d.colleges ?? [];
        setColleges(list);
        if (list.length === 1) setCollegeId(list[0].id);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setLoaded(true));
  }, [collegesUrl]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 max-w-md">
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={collegeId} onValueChange={setCollegeId} disabled={!loaded || colleges.length === 0}>
          <SelectTrigger><SelectValue placeholder={loaded ? "Select a college" : "Loading colleges..."} /></SelectTrigger>
          <SelectContent>
            {colleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {collegeId ? (
        <RoleAssignmentsPage key={collegeId} collegeId={collegeId} />
      ) : (
        loaded && <p className="text-sm text-muted-foreground">Pick a college to manage its role assignments.</p>
      )}
    </div>
  );
}
