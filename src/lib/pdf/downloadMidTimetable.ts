import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { getMidTimetableHTML, type MidTimetablePrint } from "@/lib/pdf/midTimetableTemplate";

/** Mid exam timetable(s) as a PDF, built in the browser; only the letterhead is fetched. */
export async function downloadMidTimetablePdf(timetables: MidTimetablePrint[], fileName: string): Promise<void> {
  const [info, logoUrl] = await Promise.all([
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; affiliation?: string; address?: string }>,
    fetchCollegeLogoUrl(),
  ]);
  const html = getMidTimetableHTML({ college: { name: info.name || "College", affiliation: info.affiliation, address: info.address, logoUrl }, timetables });
  await renderHtmlToPdf(html, `${fileName.replace(/[^a-zA-Z0-9-_]+/g, "-")}.pdf`);
}
