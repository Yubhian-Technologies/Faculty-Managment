import { redirect } from "next/navigation";

// Merged into the Curriculum journey's Structure step, under its Documents
// switcher. Kept as a redirect for any bookmarked links.
export default function AcademicsRegulationRedirect() {
  redirect("/academics/course-structure?step=documents");
}
