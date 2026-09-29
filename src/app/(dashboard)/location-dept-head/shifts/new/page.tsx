"use client";

import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DeptHeadNewShiftRedirectPage() {
  return (
    <div className="space-y-4 max-w-lg mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <Link href="/location-dept-head/shifts">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Shift Creation</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Campus-wide shift configuration rules.
          </p>
        </div>
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardHeader className="text-center pb-2">
          <div className="h-12 w-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2">
            <Clock className="h-6 w-6" />
          </div>
          <CardTitle className="text-base font-bold">Configured by Location Staff Admin</CardTitle>
          <CardDescription className="text-xs max-w-sm mx-auto">
            Working shifts and their timing rules are centrally configured and created by the Location Staff Admin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-xs text-muted-foreground">
            As a Department Head, you can assign your department staff to shifts, rotate rosters, and take shift-wise attendance.
          </p>
          <Button asChild className="rounded-full text-xs font-semibold px-5">
            <Link href="/location-dept-head/shifts">View Department Shifts</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
