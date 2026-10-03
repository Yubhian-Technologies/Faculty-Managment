import { describe, it, expect } from "vitest";
import Excel from "exceljs";
import {
  buildStudentReportPrintHtml,
  buildStudentReportWorkbook,
  studentReportFilename,
  studentReportIdentity,
  type StudentReportData,
} from "./studentReportExport";

const report: StudentReportData = {
  college: { name: "Vishnu Institute of Technology ( Code: PA )", address: "VISHNUPUR, BHIMAVARAM", phone: "08816251333", logoUrl: "" },
  scope: { view: "tillnow", label: "Till now", from: null, to: null },
  student: { rollNumber: "24pa1a05j7", name: "REDDY GURUNADA RAO", course: "B.Tech", branch: "CSE", classLabel: "III/IV Semester-I" },
  subjects: [
    { subjectId: "a", code: "DWDM", held: 68, attended: 61, percent: 89.71 },
    { subjectId: "b", code: "Seminar", held: 17, attended: 11, percent: 64.71 },
  ],
  total: { held: 85, attended: 72, percent: 84.71 },
};

describe("student report export", () => {
  it("identity block uses short forms", () => {
    expect(studentReportIdentity(report)).toEqual([
      ["RollNo", "24pa1a05j7"], ["Student Name", "REDDY GURUNADA RAO"], ["Course", "B.Tech"],
      ["Branch", "CSE"], ["Semester", "III/IV Semester-I"], ["Period", "Till now"],
    ]);
  });

  it("print html follows the college layout: letterhead, title, Sl.No/Subject/Held/Attend/%, TOTAL", () => {
    const html = buildStudentReportPrintHtml(report, new Date("2026-10-03T08:00:00Z"), 75, "https://x/logo.png");
    expect(html).toContain("VISHNU INSTITUTE OF TECHNOLOGY ( CODE: PA )");
    expect(html).toContain("ATTENDANCE REPORT");
    expect(html).toContain("<th>Sl.No.</th><th>Subject</th><th>Held</th><th>Attend</th><th>%</th>");
    expect(html).toContain("<td>1</td><td>DWDM</td><td>68</td><td>61</td><td>89.71</td>");
    expect(html).toContain('<td class="low">64.71</td>'); // below 75 is flagged
    expect(html).toContain("TOTAL</td><td>85</td><td>72</td><td>84.71</td>");
    expect(html).toContain("Tel : 08816251333");
  });

  it("escapes user-controlled text", () => {
    const html = buildStudentReportPrintHtml({ ...report, student: { ...report.student, name: "<script>x</script>" } }, new Date(), 75, "");
    expect(html).not.toContain("<script>x</script>");
  });

  it("workbook has the same rows, numeric cells and a TOTAL line", () => {
    const sheet = buildStudentReportWorkbook(Excel as never, report).getWorksheet("Attendance Report")!;
    const rows: unknown[][] = [];
    sheet.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    // exceljs mirrors a merged cell's value into its covered cells - collapse the repeats.
    const flat = rows.map((r) => r.filter((v, i) => v !== "" && v != null && v !== r[i - 1]).join("|"));
    expect(flat).toContain("ATTENDANCE REPORT");
    expect(flat).toContain("Branch :|CSE");
    expect(flat).toContain("Sl.No.|Subject|Held|Attend|%");
    expect(flat).toContain("1|DWDM|68|61|89.71");
    expect(flat).toContain("TOTAL|85|72|84.71");
    const dwdm = sheet.getRow(sheet.rowCount - 2);
    expect(typeof dwdm.getCell(5).value).toBe("number");
  });

  it("filename is safe", () => {
    expect(studentReportFilename(report)).toBe("Attendance_24pa1a05j7_Till_now");
  });
});
