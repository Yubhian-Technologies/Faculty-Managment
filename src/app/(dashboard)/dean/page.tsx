"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/types";

export default function DeanDashboard() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "there"}`}
        description={ROLE_LABELS.DEAN}
      />
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Your account was created by the Principal. Access to specific modules is granted by your
          college&apos;s administration as needed.
        </CardContent>
      </Card>
    </div>
  );
}
