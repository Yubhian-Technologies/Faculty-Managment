"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { FacultyPublicProfileView, type FacultyPublicProfile } from "@/components/faculty/FacultyPublicProfileView";

// URL is domain/faculty-public/facultyid=<employeeId> - the whole "facultyid=EMP0001"
// segment is captured as one dynamic param and parsed here, rather than a
// query string, so the link reads as one short, human-typeable token.
// Next.js's client router hands back the raw "=" inside this segment as the
// escape sequence "%3D" rather than decoding it (confirmed live - the prefix
// strip below silently failed until this decode was added), so always
// decode first regardless of which form we're handed.
function parseEmployeeId(param: string): string {
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    // malformed sequence - fall back to the raw value
  }
  return decoded.replace(/^facultyid=/i, "");
}

export default function FacultyPublicProfilePage() {
  const { param } = useParams<{ param: string }>();
  const employeeId = useMemo(() => parseEmployeeId(param ?? ""), [param]);
  const [profile, setProfile] = useState<FacultyPublicProfile | null>(null);
  const [loading, setLoading] = useState(!!employeeId);

  useEffect(() => {
    if (!employeeId) return;
    fetch(`/api/public/faculty-public?employeeId=${encodeURIComponent(employeeId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ profile: FacultyPublicProfile }>) : null))
      .then((d) => setProfile(d?.profile ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [employeeId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-sm w-full mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive text-sm">Profile not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <FacultyPublicProfileView profile={profile} />;
}
