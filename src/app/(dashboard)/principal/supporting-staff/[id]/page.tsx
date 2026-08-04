"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, User, IdCard, GraduationCap, FileText, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/SectionCard";
import { Avatar } from "@/components/shared/Avatar";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { SupportingStaffProfileView } from "@/components/supportingStaff/SupportingStaffProfileView";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import {
  STAFF_CATEGORY_LABELS, TECHNICAL_STAFF_DESIGNATION_LABELS, NON_TECHNICAL_STAFF_DESIGNATION_LABELS,
  EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS,
} from "@/types";
import type { SupportingStaffMember } from "@/types";

export default function PrincipalSupportingStaffDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [staff, setStaff] = useState<SupportingStaffMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/college/supporting-staff/${id}`)
      .then((r) => r.json() as Promise<{ staff?: SupportingStaffMember }>)
      .then((d) => setStaff(d.staff ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  const designationLabel = staff
    ? staff.designation === "OTHER" && staff.otherDesignationTitle
      ? staff.otherDesignationTitle
      : ((staff.staffCategory === "TECHNICAL" ? TECHNICAL_STAFF_DESIGNATION_LABELS : NON_TECHNICAL_STAFF_DESIGNATION_LABELS) as Record<string, string>)[staff.designation]
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={staff?.name ?? "Supporting Staff"}
        description={staff ? `${STAFF_CATEGORY_LABELS[staff.staffCategory]} · ${designationLabel}` : undefined}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/principal/supporting-staff")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            {staff && (
              <Button onClick={() => router.push(`/principal/supporting-staff/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />Edit
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !staff ? (
        <p className="text-sm text-muted-foreground">Staff record not found.</p>
      ) : (
        <>
          <SectionCard icon={User} title="Identity" accent="blue">
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={staff.name} photoUrl={staff.profilePhotoUrl} size="lg" />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{staff.employeeId}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{staff.email || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{staff.phone || "—"}</p></div>
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm font-medium">
                  {staff.department || <Badge variant="secondary" className="text-xs">Not assigned</Badge>}
                </p>
              </div>
              <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{designationLabel}</p></div>
              <div><p className="text-xs text-muted-foreground">Employment Type</p><p className="text-sm font-medium">{EMPLOYMENT_TYPE_LABELS[staff.employmentType]}</p></div>
              <div><p className="text-xs text-muted-foreground">Status</p><p className="text-sm font-medium">{FACULTY_STATUS_LABELS[staff.status]}</p></div>
              <div><p className="text-xs text-muted-foreground">Date of Joining</p><p className="text-sm font-medium">{staff.joiningDate ? formatDate(staff.joiningDate) : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Experience (yrs)</p><p className="text-sm font-medium">{staff.experienceYears}</p></div>
            </div>
          </SectionCard>

          <SectionCard icon={IdCard} title="Personal Details" accent="violet">
            <PersonalDetailsView value={staff} />
          </SectionCard>

          <SectionCard icon={GraduationCap} title="Profile" accent="emerald">
            <SupportingStaffProfileView profile={staff.supportingStaffProfile} staffCategory={staff.staffCategory} />
          </SectionCard>

          {(staff.joiningLetterUrl || staff.appointmentLetterUrl) && (
            <SectionCard icon={FileText} title="Documents" accent="violet">
              <div className="flex flex-wrap gap-4">
                {staff.joiningLetterUrl && (
                  <a href={staff.joiningLetterUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <FileText className="h-4 w-4" />Joining Letter
                  </a>
                )}
                {staff.appointmentLetterUrl && (
                  <a href={staff.appointmentLetterUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <FileText className="h-4 w-4" />Appointment Letter
                  </a>
                )}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
