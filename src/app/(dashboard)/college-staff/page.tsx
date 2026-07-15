"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";

export default function CollegeStaffDashboard() {
  const user = useAuthStore((s) => s.user);
  const title = user?.designation;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "there"}`}
        description={title ?? "College Staff"}
      />
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Your account was created by the Principal{title ? ` with the title "${title}"` : ""}. Access to
          specific modules is granted by your college&apos;s administration as needed.
        </CardContent>
      </Card>
    </div>
  );
}
