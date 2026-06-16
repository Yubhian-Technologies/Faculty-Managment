"use client";

import { Plus, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Apply for leave and track your applications" actions={<Button disabled><Plus className="h-4 w-4 mr-2" />Apply Leave</Button>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[{label:"Casual Leave",c:"text-blue-700"},{label:"Sick Leave",c:"text-red-700"},{label:"Earned Leave",c:"text-green-700"},{label:"Compensatory",c:"text-amber-700"}].map((lt)=>(
          <Card key={lt.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{lt.label}</p><p className={"text-2xl font-bold mt-1 "+lt.c}>—</p><p className="text-xs text-muted-foreground">days remaining</p></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-8"><EmptyState title="Leave module coming soon" description="Apply for casual, sick and earned leave with approval workflow." icon={<CalendarClock className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
