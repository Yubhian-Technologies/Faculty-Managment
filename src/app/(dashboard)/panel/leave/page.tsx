"use client";

import { CalendarClock, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function FacultyLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        description="Apply for leave and track your applications"
        actions={
          <Button disabled>
            <Plus className="h-4 w-4 mr-2" />
            Apply Leave
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Casual Leave", balance: "—", color: "bg-blue-50 text-blue-700" },
          { label: "Sick Leave", balance: "—", color: "bg-red-50 text-red-700" },
          { label: "Earned Leave", balance: "—", color: "bg-green-50 text-green-700" },
          { label: "Compensatory", balance: "—", color: "bg-amber-50 text-amber-700" },
        ].map((lt) => (
          <Card key={lt.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{lt.label}</p>
              <p className={`text-2xl font-bold mt-1 ${lt.color.split(" ")[1]}`}>{lt.balance}</p>
              <p className="text-xs text-muted-foreground">days remaining</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Leave module coming soon"
            description="Apply for casual, sick, earned and other leave types. HOD and Principal approval workflow will be available here."
            icon={<CalendarClock className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
