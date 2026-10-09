import { redirect } from "next/navigation";

// "Timetable View" is no longer a page of its own: the Timetable page's
// Published mode shows the same grid and downloads, and now carries the week
// navigation and leisure-faculty check this page had. Kept as a redirect so an
// old bookmark or link still lands somewhere useful.
export default function HODTimetableViewPage() {
  redirect("/hod/timetable");
}
