"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSupportingStaffProfileModules } from "@/lib/supportingStaff/profileModules";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { supportingStaffCategoryLabel } from "@/lib/supportingStaff/roleCategory";
import { totalYearsOfExperience, formatDuration } from "@/lib/faculty/experienceCalc";
import { formatDate } from "@/lib/utils";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyStatus, SupportingStaffMember } from "@/types";

// A Supporting Staff member's own "My Profile" building blocks - the counterparts of FacultyIdentityFacts /
// FacultyStatusBadge / MyProfileModuleTiles (components/faculty/FacultyProfileHub), laid out the same way, but for the
// supportingStaff record and its own sections (Personal Details, Qualifications, Job Responsibilities & Skills,
// Training, Awards & Recognition, Others) instead of the faculty ones.

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
  RETAINERSHIP: "default",
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

export function SupportingStaffStatusBadge({ status }: { status?: FacultyStatus }) {
  if (!status) return null;
  return <Badge variant={STATUS_VARIANTS[status] ?? "secondary"}>{FACULTY_STATUS_LABELS[status] ?? status}</Badge>;
}

export function staffDesignationLabel(staff: Partial<SupportingStaffMember>): string | undefined {
  if (staff.designation === "OTHER" && staff.otherDesignationTitle) return staff.otherDesignationTitle;
  return staff.designation ? (NON_TECHNICAL_STAFF_DESIGNATION_LABELS[staff.designation] ?? staff.designation) : undefined;
}

// Same order as the Add / Edit Supporting Staff wizard (Identity & Employment -> Role Details -> Employment ->
// Contact), so this reads as "the same fields, just read-only" - exactly how the faculty summary reads.
export function SupportingStaffIdentityFacts({ staff }: { staff: Partial<SupportingStaffMember> }) {
  const joining = staff.joiningDate;
  const category = staff.staffCategory ? supportingStaffCategoryLabel(staff.staffCategory) : undefined;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Fact label="Employee ID" value={staff.employeeId} />
      <Fact label="Full Name (as per SSC)" value={supportingStaffDisplayName(staff) || staff.legalName} />
      <Fact label="APAAR Faculty ID" value={staff.apaarFacultyId} />
      <Fact label="Department" value={staff.department || "Centrally managed"} />
      <Fact label="College Email" value={staff.collegeEmail} />
      <Fact label="Designation" value={staffDesignationLabel(staff)} />
      <Fact label="Staff Category" value={category} />
      <Fact label="Highest Qualification" value={staff.highestQualification} />
      {/* Ticks up day by day from the Date of Joining - same live tenure the faculty summary shows. */}
      <Fact label="Total Years of Experience" value={joining ? formatDuration(totalYearsOfExperience(undefined, joining)) : undefined} />
      <Fact label="Date of Joining" value={joining ? formatDate(joining) : undefined} />
      <Fact label="Mobile No" value={staff.mobileNo} />
      <Fact label="Personal Email" value={staff.email} />
      {(staff.additionalPhoneNumbers ?? []).length > 0 && (
        <Fact
          label="Additional Mobile Numbers"
          value={
            <span className="flex flex-col gap-0.5">
              {staff.additionalPhoneNumbers?.map((p, i) => (
                <span key={i}>{p.number}{p.label ? ` (${p.label})` : ""}</span>
              ))}
            </span>
          }
        />
      )}
    </div>
  );
}

export function SupportingStaffModuleTiles({ basePath }: { basePath: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {getSupportingStaffProfileModules().map((m) => (
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
  );
}
