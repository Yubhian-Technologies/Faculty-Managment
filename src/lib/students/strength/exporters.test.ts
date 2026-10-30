import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildStrengthCube } from "./aggregate";
import { buildPrintHtml, buildStrengthWorkbook, strengthCsvRows, type ExportContext } from "./exporters";
import { buildReport } from "./query";
import type { SectionRow, StrengthRow } from "./types";

let n = 0;
const many = (count: number, over: Partial<StrengthRow>): StrengthRow[] =>
  Array.from({ length: count }, () => ({ id: `e${++n}`, department: "IT", course: "B.Tech", year: 1, section: "A", status: "REGULAR", ...over }));

const rows = [
  ...many(59, { department: "CIVIL", year: 1 }),
  ...many(64, { department: "CIVIL", year: 2 }),
  ...many(256, { department: "IT", year: 1, section: "A" }),
  ...many(12, { department: "AMFS", course: "M.Tech", year: 1, section: "M" }),
  ...many(7, { department: "AMFS", course: "M.Tech", year: 2, section: "M" }),
  ...many(3, { department: 'R&D <script>alert(1)</script>', course: "B.Tech", year: 1 }),
];
const { cells, meta } = buildStrengthCube(rows, { courses: [{ id: "b", name: "B.Tech", durationYears: 2 }, { id: "m", name: "M.Tech", durationYears: 2 }], departments: [], sections: [] });
const report = buildReport(cells, meta, { status: "ENROLLED" });
const ctx: ExportContext = {
  collegeName: "Vishnu Institute of Technology",
  session: "2026-27",
  selection: "Whole college",
  statusRule: "Enrolled students",
  generatedAt: new Date("2026-09-30T10:00:00Z"),
};

describe("Excel export", () => {
  it("lays out the sheet like the office's manual sheet, and every number reads back correctly", async () => {
    const wb = buildStrengthWorkbook(ExcelJS, report, ctx);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);

    const ws = back.getWorksheet("Strength")!;
    const grid: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => grid.push((row.values as (string | number | null)[]).slice(1)));
    const find = (label: string) => grid.find((r) => r.includes(label))!;

    expect(grid[0][0]).toBe("VISHNU INSTITUTE OF TECHNOLOGY");
    expect(grid[1][0]).toBe("2026-27 - STUDENT STRENGTH");
    const civil = find("CIVIL");
    expect(civil.filter((v) => typeof v === "number")).toEqual([1, 59, 64, 123]); // SL, I, II, TOTAL (2-year fixture)
    const it = find("IT");
    expect(it.filter((v) => typeof v === "number")).toEqual([2, 256, 0, 256]);
    const overall = find("OVERALL STRENGTH");
    expect(overall[overall.length - 1]).toBe(report.total);
    expect(report.total).toBe(59 + 64 + 256 + 12 + 7 + 3);

    const sec = back.getWorksheet("Section-wise")!;
    expect(sec.getRow(1).values).toEqual([undefined, "Course", "Department", "Year", "Section", "Students"]);
    const last = sec.getRow(sec.rowCount).values as (string | number)[];
    expect(last[1]).toBe("TOTAL");
    expect(last[5]).toBe(report.total);
    // section rows add up to the total
    let sum = 0;
    for (let i = 2; i < sec.rowCount; i++) sum += Number(sec.getRow(i).getCell(5).value);
    expect(sum).toBe(report.total);
  });
});

describe("CSV export", () => {
  it("emits one row per program/department/year/section plus a TOTAL that matches", () => {
    const csv = strengthCsvRows(report);
    expect(csv[0]).toEqual(["Course", "Department", "Year", "Section", "Students"]);
    expect(csv.slice(1, -1).reduce((s, r) => s + Number(r[4]), 0)).toBe(report.total);
    expect(csv[csv.length - 1]).toEqual(["TOTAL", "", "", "", String(report.total)]);
    expect(csv).toContainEqual(["M.Tech", "AMFS", "II", "M", "7"]);
  });
});

describe("print page", () => {
  const html = buildPrintHtml(report, ctx);
  it("includes the totals", () => {
    expect(html).toContain("OVERALL STRENGTH");
    expect(html).toContain(`<span>${report.total}</span>`);
    expect(html).toContain("B.TECH");
    expect(html).toContain("M.TECH");
  });
  it("escapes department names - no markup injection from student data", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("R&amp;D &lt;script&gt;");
  });
});

describe("print page: section-wise blocks", () => {
  const sec = (over: Partial<SectionRow>): SectionRow => ({
    program: "btech", programLabel: "Bachelor of Technology", branch: "cse", branchLabel: "Computer Science and Engineering", branchCode: "CSE",
    year: 1, section: "cse-a", sectionLabel: "CSE-A", count: 10, ...over,
  });
  const cse: SectionRow[] = [];
  for (const [i, y] of [1, 2, 3, 4].entries()) {
    for (const [j, s] of ["A", "B", "C", "D"].entries()) {
      cse.push(sec({ year: y, section: `cse-${s.toLowerCase()}`, sectionLabel: `CSE-${s}`, count: 10 * (i + 1) + j }));
    }
  }
  const mech = [1, 2, 3, 4].map((y) => sec({ branch: "mech", branchLabel: "Mechanical Engineering", branchCode: "MECH", year: y, section: "mech-a", sectionLabel: "MECH-A", count: 50 + y }));
  const civil = [1, 2].map((y) => sec({ branch: "civil", branchLabel: "Civil Engineering", branchCode: "CIVIL", year: y, section: "a", sectionLabel: "A", count: 30 + y }));
  const mtech = [sec({ program: "mtech", programLabel: "Master of Technology", branch: "amfs", branchLabel: "AMFS", branchCode: "", year: 1, section: "m", sectionLabel: "M", count: 12 })];
  const empty = sec({ year: 2, section: "cse-e", sectionLabel: "CSE-E", count: 0 });
  const sections = [...cse, ...civil, ...mech, ...mtech, empty];
  const total = sections.reduce((n, s) => n + s.count, 0);
  const html = buildPrintHtml({ total, matrices: [], sections }, ctx);
  const blocks = html.slice(html.indexOf("SECTION-WISE"));

  it("prints each course once as a heading, not as a column", () => {
    expect(blocks.match(/BACHELOR OF TECHNOLOGY/g)).toHaveLength(1);
    expect(blocks.match(/MASTER OF TECHNOLOGY/g)).toHaveLength(1);
    expect(blocks).not.toContain("<th>Course</th>");
    expect(blocks).not.toContain("<th>Section</th>");
  });

  it("prints the department once with its total, years as rows and sections as columns without the prefix", () => {
    const cseTotal = cse.reduce((n, s) => n + s.count, 0);
    expect(blocks).toContain(`<h4><span>CSE &mdash; Computer Science and Engineering</span><span class="amt">${cseTotal}</span></h4>`);
    expect(blocks).toContain("<thead><tr><th>Year</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Total</th></tr></thead>");
    expect(blocks).not.toContain("CSE-A");
    // year I row: 10,11,12,13 = 46
    expect(blocks).toContain('<tr><td class="c">I</td><td class="n">10</td><td class="n">11</td><td class="n">12</td><td class="n">13</td><td class="n b">46</td></tr>');
    // Total row closes the table with the grand total
    expect(blocks).toContain(`<tr class="tot"><td class="c">Total</td>`);
    expect(blocks).toContain(`<td class="n">${cseTotal}</td></tr></tbody>`);
  });

  it("hides sections with no students", () => {
    expect(blocks).not.toContain("<th>E</th>");
    expect(blocks).not.toContain("CSE-E");
  });

  it("puts single-section departments together in one shared table", () => {
    expect(blocks.match(/Departments with a single section/g)).toHaveLength(2); // B.Tech and M.Tech each get one
    expect(blocks).toContain("<th>Department</th><th>I</th><th>II</th><th>III</th><th>IV</th><th>Total</th>");
    expect(blocks).toContain('<tr><td>MECH</td><td class="n">51</td><td class="n">52</td><td class="n">53</td><td class="n">54</td><td class="n b">210</td></tr>');
    // CIVIL has years I-II only: the rest is a dash, not a made-up 0
    expect(blocks).toContain('<tr><td>CIVIL</td><td class="n">31</td><td class="n">32</td><td class="n nil">&ndash;</td><td class="n nil">&ndash;</td><td class="n b">63</td></tr>');
    // single-section departments do not get a block of their own
    expect(blocks).not.toContain("MECH &mdash;");
    expect(blocks).not.toContain("CIVIL &mdash;");
    // a department with no code falls back to its name
    expect(blocks).toContain("<td>AMFS</td>");
  });

  it("keeps every block together on a page", () => {
    expect(html).toMatch(/\.dept\{[^}]*page-break-inside:avoid/);
    expect(html).toMatch(/\.dept\{[^}]*break-inside:avoid/);
    expect(blocks.match(/<div class="dept">/g)!.length).toBe(blocks.match(/<\/table><\/div>/g)!.length);
  });

  it("loses no students: the department totals add up to the report total", () => {
    const headings = [...blocks.matchAll(/<h4><span>[^<]*<\/span><span class="amt">(\d+)<\/span><\/h4>/g)].map((m) => Number(m[1]));
    const singleRows = [...blocks.matchAll(/<tr><td>(?!Total)[^<]*<\/td>(?:<td class="n(?: nil)?">[^<]*<\/td>)+<td class="n b">(\d+)<\/td><\/tr>/g)].map((m) => Number(m[1]));
    expect(headings.reduce((a, b) => a + b, 0) + singleRows.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("does not merge two sections whose labels collide once the prefix is dropped", () => {
    const clash = [
      sec({ section: "cse-a", sectionLabel: "CSE-A", count: 5 }),
      sec({ section: "a", sectionLabel: "A", count: 7 }),
    ];
    const h = buildPrintHtml({ total: 12, matrices: [], sections: clash }, ctx);
    expect(h).toContain("<th>A</th><th>CSE-A</th>");
    expect(h).toContain('<td class="n b">12</td>');
  });

  it("keeps students with no year or no section instead of dropping them", () => {
    const odd = [
      sec({ year: 1, section: "cse-a", sectionLabel: "CSE-A", count: 4 }),
      sec({ year: 0, section: "cse-a", sectionLabel: "CSE-A", count: 3 }),
      sec({ year: 1, section: "", sectionLabel: "No section", count: 2 }),
    ];
    const h = buildPrintHtml({ total: 9, matrices: [], sections: odd }, ctx);
    expect(h).toContain("<th>A</th><th>No section</th>");
    expect(h).toContain('<td class="c">-</td>');
    expect(h).toContain('<span class="amt">9</span></h4>');
  });

  it("omits the section-wise part when nothing is to be shown", () => {
    expect(buildPrintHtml({ total: 0, matrices: [], sections: [empty] }, ctx)).not.toContain("SECTION-WISE");
    expect(buildPrintHtml({ total, matrices: [], sections }, ctx, { includeSections: false })).not.toContain("SECTION-WISE");
  });
});

describe("print page: look", () => {
  const html = buildPrintHtml(report, ctx);
  it("sets up A4 with a running footer (generated time left, page X of Y right)", () => {
    expect(html).toContain("@page{size:A4;margin:14mm 12mm;");
    expect(html).toContain('@bottom-left{content:"Generated ');
    expect(html).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages)');
    expect(html).toContain("print-color-adjust:exact");
  });
  it("keeps the footer text inside the stylesheet", () => {
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });
  it("lays blocks out in two columns, numbers right-aligned in tabular figures, rules between rows only", () => {
    expect(html).toContain(".depts{display:grid;grid-template-columns:1fr 1fr");
    expect(html).toContain("td.n{text-align:right;font-variant-numeric:tabular-nums}");
    expect(html).toContain("table-layout:fixed");
    expect(html).not.toMatch(/(th,td|td|th)\{[^}]*border:1px solid #333/);
  });
  it("still prints the summary tables and the overall strength", () => {
    expect(html).toContain(`<span>OVERALL STRENGTH</span><span>${report.total}</span>`);
    expect(html).toContain('<table class="summary">');
    expect(html).toContain('<header class="hd">');
  });
});
