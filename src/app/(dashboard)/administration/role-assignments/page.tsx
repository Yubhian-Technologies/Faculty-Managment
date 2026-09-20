import { CollegeRoleAssignments } from "@/components/roles/CollegeRoleAssignments";

export default function AdministrationRoleAssignmentsPage() {
  return <CollegeRoleAssignments collegesUrl="/api/admin/colleges" />;
}
