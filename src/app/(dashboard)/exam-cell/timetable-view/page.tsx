// Exam Cell's read-only view of published timetables - the same
// course -> department -> year -> section picker (with PDF/Excel download) that
// Principal, Vice Principal, College Admin and Director use. Data access is
// enforced by each /api/college/* route's own guard, not by this re-export.
export { default } from "@/app/(dashboard)/principal/timetable/page";
