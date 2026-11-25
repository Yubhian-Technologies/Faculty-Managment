"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";

// College picker for the location fee logins (Accounts, Scholarship Cell): the colleges of their location
// (api/college/fees/colleges). Picks the only one by itself.

export function useFeeCollege() {
  const [colleges, setColleges] = useState<{ id: string; name: string }[] | null>(null);
  const [collegeId, setCollegeId] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/college/fees/colleges").then((r) => r.json() as Promise<{ colleges?: { id: string; name: string }[] }>)
      .then((d) => { if (!live) return; const list = d.colleges ?? []; setColleges(list); if (list.length === 1) setCollegeId(list[0].id); })
      .catch(() => { if (live) setColleges([]); });
    return () => { live = false; };
  }, []);
  return { colleges, collegeId, setCollegeId };
}

export function CollegePicker({ colleges, collegeId, onChange }: { colleges: { id: string; name: string }[] | null; collegeId: string; onChange: (id: string) => void }) {
  return (
    <div className="w-72 space-y-1">
      <Label htmlFor="fee-college-pick" className="text-xs">College</Label>
      <select id="fee-college-pick" className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" value={collegeId} onChange={(e) => onChange(e.target.value)}>
        <option value="">{colleges === null ? "Loading..." : colleges.length ? "Select a college" : "No colleges in your location"}</option>
        {(colleges ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}
