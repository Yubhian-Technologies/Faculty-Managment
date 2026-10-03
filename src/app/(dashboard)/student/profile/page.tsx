"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/shared/Avatar";
import { PageHeader } from "@/components/shared/PageHeader";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";

interface Row {
  label: string;
  value: string;
}

interface ProfileResponse {
  header: { name: string; rollNumber: string; photoUrl: string; status: string };
  identity: Row[];
  groups: { title: string; rows: Row[] }[];
  error?: string;
}

function Fields({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{r.label}</dt>
          <dd className="break-words text-sm font-medium">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// "My Profile" - everything the college holds about the logged-in student, on
// one page (reached from the avatar in the top bar). Read-only: corrections go
// through the College Office. The server sends ready-made rows with staff-only
// fields removed.
export default function StudentProfilePage() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/student/me/profile")
      .then(async (r) => {
        const body = (await r.json()) as ProfileResponse;
        if (!r.ok) throw new Error(body.error ?? "Failed to load your profile");
        setData(body);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load your profile"))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="My Profile"
        description="The details your college holds for you. To correct anything, contact the College Office."
        actions={<ChangePasswordDialog />}
      />

      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error || !data ? (
        <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">{error}</div>
      ) : (
        <>
          <Card className="rounded-2xl border-border/60 bg-card/90 shadow-xs">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-4">
                <Avatar name={data.header.name} photoUrl={data.header.photoUrl} size="lg" />
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold leading-tight">{data.header.name}</h2>
                  <p className="text-sm text-muted-foreground">{data.header.rollNumber}</p>
                  <p className="text-xs text-muted-foreground">{data.header.status}</p>
                </div>
              </div>
              <Fields rows={data.identity} />
            </CardContent>
          </Card>

          {data.groups.map((g) => (
            <Card key={g.title} className="rounded-2xl border-border/60 bg-card/90 shadow-xs">
              <CardContent className="space-y-3 p-4 sm:p-5">
                <h3 className="text-sm font-semibold">{g.title}</h3>
                <Fields rows={g.rows} />
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
