"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/shared/Avatar";
import { getSupportingStaffProfileModules } from "@/lib/supportingStaff/profileModules";
import { formatDate } from "@/lib/utils";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { SupportingStaffMember, FacultyStatus } from "@/types";

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

interface Props {
  staff: Partial<SupportingStaffMember>;
  basePath: string; // e.g. "/college-office/non-technical-staff/abc123"
  backHref?: string;
  editHref?: string;
}

// Landing page for a Supporting Staff member's details - identity summary +
// one tile per module, mirroring FacultyProfileHub (see that file's own
// comment) but for the simpler SupportingStaffProfileFields shape.
export function SupportingStaffProfileHub({ staff, basePath, backHref, editHref }: Props) {
  const designationLabel = staff.designation === "OTHER" && staff.otherDesignationTitle
    ? staff.otherDesignationTitle
    : staff.designation
      ? (NON_TECHNICAL_STAFF_DESIGNATION_LABELS[staff.designation] ?? staff.designation)
      : undefined;
  const modules = getSupportingStaffProfileModules();

  return (
    <div className="space-y-6">
      <PageHeader
        title={staff.name ?? "Staff Member"}
        description={designationLabel}
        actions={
          <div className="flex gap-2">
            {backHref && (
              <Button variant="outline" asChild>
                <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
              </Button>
            )}
            {editHref && (
              <Button asChild>
                <Link href={editHref}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <Avatar name={staff.name ?? "?"} photoUrl={staff.profilePhotoUrl} size="lg" />
            {staff.status && <Badge variant={STATUS_VARIANTS[staff.status] ?? "secondary"}>{FACULTY_STATUS_LABELS[staff.status] ?? staff.status}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Employee ID" value={staff.employeeId} />
            <Fact label="College Email" value={staff.collegeEmail} />
            <Fact label="Phone" value={staff.phone} />
            <Fact label="Department" value={staff.department || "Centrally managed"} />
            <Fact label="Designation" value={designationLabel} />
            <Fact label="Employment Type" value={staff.employmentType ? EMPLOYMENT_TYPE_LABELS[staff.employmentType] : undefined} />
            <Fact label="Date of Joining" value={staff.joiningDate ? formatDate(staff.joiningDate) : undefined} />
            <Fact label="Experience (yrs)" value={staff.experienceYears} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Link key={m.key} href={`${basePath}/${m.key}`}>
            <Card className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <m.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-medium">{m.label}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
