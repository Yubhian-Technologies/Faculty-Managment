import { redirect } from "next/navigation";

// Sections now live under the Courses page as a toggle.
export default function SectionsPage() {
  redirect("/principal/courses?tab=sections");
}
