import { CollegeRoleAssignments } from "@/components/roles/CollegeRoleAssignments";

export default function ManagementRoleAssignmentsPage() {
  return <CollegeRoleAssignments collegesUrl="/api/management/colleges" />;
}
