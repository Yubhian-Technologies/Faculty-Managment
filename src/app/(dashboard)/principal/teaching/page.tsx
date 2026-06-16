"use client";

import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalTeachingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Teaching Load" description="Your subjects and timetable" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Teaching load coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
