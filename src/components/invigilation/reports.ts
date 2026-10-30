import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { ACTIVE_DUTY_STATUSES, DUTY_CATEGORY_LABELS, type DutyCategory, type InvigilationDuty } from "@/types/invigilation";
import { designationLabel, type Overview } from "./model";

// The invigilation reports as plain tables (headers + rows) - shown on screen
// and exported to Excel / PDF by lib/attendance/tableExport.

export type ReportKey = "faculty" | "session" | "room" | "department" | "designation" | "reliever" | "squad";
export const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "faculty", label: "Faculty-wise duties" },
  { key: "session", label: "Date & session-wise" },
  { key: "room", label: "Room-wise invigilators" },
  { key: "department", label: "Department-wise workload" },
  { key: "designation", label: "Designation-wise workload" },
  { key: "reliever", label: "Reliever allocation" },
  { key: "squad", label: "Special squad allocation" },
];

const live = (d: InvigilationDuty) => ACTIVE_DUTY_STATUSES.includes(d.status);
const when = (d: Pick<InvigilationDuty, "date" | "from" | "to">) => [dayLabel(d.date), `${timeLabel(d.from)} - ${timeLabel(d.to)}`];
const sortDuty = (a: InvigilationDuty, b: InvigilationDuty) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from) || (a.room ?? "").localeCompare(b.room ?? "", undefined, { numeric: true }) || a.facultyName.localeCompare(b.facultyName);

export function buildReport(key: ReportKey, o: Overview): { headers: string[]; rows: (string | number)[][] } {
  const duties = o.duties.filter(live).sort(sortDuty);
  const count = (list: InvigilationDuty[], c?: DutyCategory) => list.filter((d) => (!c || d.category === c) && o.schedule.rules.countCategories.includes(d.category)).length;
  switch (key) {
    case "faculty": {
      const rows = o.faculty.filter((f) => o.duties.some((d) => d.facultyId === f.id)).map((f) => {
        const mine = o.duties.filter((d) => d.facultyId === f.id);
        const act = mine.filter(live);
        return [f.employeeId, f.name, f.department, designationLabel(f.designation),
          act.filter((d) => d.category === "INVIGILATOR").length, act.filter((d) => d.category === "RELIEVER").length, act.filter((d) => d.category === "SQUAD").length,
          count(act), mine.filter((d) => d.status === "COMPLETED").length, mine.filter((d) => d.status === "CANCELLED").length, mine.filter((d) => d.status === "REASSIGNED").length,
          act.sort(sortDuty).map((d) => `${d.date.slice(5)} ${d.from}${d.room ? ` ${d.room.replace(/^Block (\S+), Floor (\S+), Room /, "$1-")}` : ` ${DUTY_CATEGORY_LABELS[d.category]}`}`).join("; ")];
      }).sort((a, b) => Number(b[7]) - Number(a[7]) || String(a[1]).localeCompare(String(b[1])));
      return { headers: ["Emp ID", "Name", "Department", "Designation", "Invigilator", "Reliever", "Squad", "Counted total", "Completed", "Cancelled", "Reassigned", "Duties"], rows };
    }
    case "session":
      return { headers: ["Date", "Time", "Duty", "Room", "Emp ID", "Name", "Department", "Status"], rows: duties.map((d) => [...when(d), DUTY_CATEGORY_LABELS[d.category], d.room ?? "-", d.employeeId, d.facultyName, d.department, d.status]) };
    case "room": {
      const rows = o.slots.filter((s) => s.category === "INVIGILATOR").map((s) => {
        const on = duties.filter((d) => d.slotKey === s.key);
        return [s.room ?? "", ...when(s), s.students, `${on.length}/${s.required}`, on.map((d) => `${d.facultyName} (${d.employeeId})`).join(", ") || "-"];
      }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }) || String(a[1]).localeCompare(String(b[1])));
      return { headers: ["Room", "Date", "Time", "Students", "Filled", "Invigilators"], rows };
    }
    case "department":
    case "designation": {
      const keyOf = (f: { department: string; designation: string }) => (key === "department" ? f.department || "-" : designationLabel(f.designation) || "-");
      const groups = new Map<string, { faculty: number; withDuty: number; total: number; cat: Record<DutyCategory, number> }>();
      for (const f of o.faculty) {
        const g = groups.get(keyOf(f)) ?? { faculty: 0, withDuty: 0, total: 0, cat: { INVIGILATOR: 0, RELIEVER: 0, SQUAD: 0 } };
        const act = duties.filter((d) => d.facultyId === f.id);
        if (!f.inactive) g.faculty++;
        if (act.length) g.withDuty++;
        g.total += count(act);
        for (const d of act) g.cat[d.category]++;
        groups.set(keyOf(f), g);
      }
      const rows = [...groups].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
        .map(([k, g]) => [k, g.faculty, g.withDuty, g.cat.INVIGILATOR, g.cat.RELIEVER, g.cat.SQUAD, g.total, g.faculty ? (g.total / g.faculty).toFixed(2) : "0"]);
      return { headers: [key === "department" ? "Department" : "Designation", "Faculty", "With duties", "Invigilator", "Reliever", "Squad", "Counted total", "Average per faculty"], rows };
    }
    case "reliever":
    case "squad": {
      const cat: DutyCategory = key === "reliever" ? "RELIEVER" : "SQUAD";
      const rows = o.slots.filter((s) => s.category === cat).map((s) => {
        const on = duties.filter((d) => d.slotKey === s.key);
        return [...when(s), `${on.length}/${s.required}`, on.map((d) => `${d.facultyName} (${d.employeeId}, ${d.department})`).join(", ") || "-"];
      });
      return { headers: ["Date", "Time", "Filled", DUTY_CATEGORY_LABELS[cat]], rows };
    }
  }
}
