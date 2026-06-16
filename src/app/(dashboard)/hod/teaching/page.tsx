"use client";

import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODTeachingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Teaching Load" description="Your subject allocations and timetable" />
      <Card><CardContent className="p-8"><EmptyState title="Teaching load module coming soon" description="Subject allocations, lecture hours and timetable will be available here." icon={<BookOpen className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
