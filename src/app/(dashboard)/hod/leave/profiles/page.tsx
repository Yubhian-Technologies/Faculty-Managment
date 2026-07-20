"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { Users, CheckCircle, AlertCircle } from "lucide-react";
import type { EmployeeLeaveProfile } from "@/types/leave";

interface FacultyRow {
  uid: string;
  name?: string;
  department?: string;
  email?: string;
  staffType?: "teaching" | "supporting";
}

interface ProfilesData {
  faculty: FacultyRow[];
  profiles: EmployeeLeaveProfile[];
  withoutProfiles: FacultyRow[];
}

export default function HODLeaveProfilesPage() {
  const router = useRouter();
  const [data, setData] = useState<ProfilesData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leave/profiles");
      if (res.ok) {
        const d = await res.json() as ProfilesData;
        setData(d);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load faculty profiles" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const profileByUid = new Map(data?.profiles.map((p) => [p.uid, p]) ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Leave Profiles"
        description="Set up leave profiles for faculty in your department"
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded bg-muted animate-pulse" />)}
        </div>
      ) : !data || data.faculty.length === 0 ? (
        <EmptyState title="No faculty found" description="No faculty members are in your department." icon={<Users className="h-8 w-8" />} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Faculty ({data.faculty.length})
              {data.withoutProfiles.length > 0 && (
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                  {data.withoutProfiles.length} not set up
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {data.faculty.map((f) => {
                const hasProfile = profileByUid.has(f.uid);
                const profile = profileByUid.get(f.uid);
                return (
                  <div key={f.uid} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {hasProfile ? (
                          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        )}
                        <p className="text-sm font-medium truncate">{f.name ?? f.uid}</p>
                        {f.staffType && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            f.staffType === "teaching"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}>
                            {f.staffType === "teaching" ? "Teaching" : "Supporting"}
                          </span>
                        )}
                      </div>
                      {hasProfile && profile ? (
                        <p className="text-xs text-muted-foreground ml-6 capitalize">
                          {profile.employmentType} · {profile.staffCategory} · {profile.isTeachingStaff ? "Teaching" : "Non-teaching"}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-600 ml-6">Leave profile not set up</p>
                      )}
                    </div>
                    <Button size="sm" variant={hasProfile ? "outline" : "default"} onClick={() => router.push(`/hod/leave/profiles/${f.uid}/edit`)}>
                      {hasProfile ? "Edit" : "Setup"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
