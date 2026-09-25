import { redirect } from "next/navigation";

// Departments now live under the Courses page as a toggle.
export default function DepartmentsPage() {
  redirect("/principal/courses?tab=departments");
}
