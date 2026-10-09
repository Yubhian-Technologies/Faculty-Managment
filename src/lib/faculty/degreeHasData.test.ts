import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { degreeHasData } from "@/lib/faculty/degreeHasData";
import { DegreeView } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail } from "@/types";

const d = (v: Record<string, unknown>) => v as unknown as DegreeDetail;
const blank = { course: "", branch: "", specialization: "", institutionName: "", place: "", percentageCgpa: "", hallTicketNumber: "", certificateUrl: "" };

describe("degreeHasData - cleared qualification cards stay hidden", () => {
  it("a Ph.D. whose only leftover is Year of Registration 0 has no data", () => {
    expect(degreeHasData(d({ ...blank, yearOfRegistration: 0 }), "DOCTORAL")).toBe(false);
  });
  it("a Post-Doc left with yearOfAward 0 / a current-year default has no data unless AWARDED", () => {
    expect(degreeHasData(d({ ...blank, yearOfAward: 0 }), "POST_DOCTORAL")).toBe(false);
    expect(degreeHasData(d({ ...blank, yearOfAward: 2026 }), "POST_DOCTORAL")).toBe(false);
    expect(degreeHasData(d({ ...blank, status: "AWARDED", yearOfAward: 2026 }), "POST_DOCTORAL")).toBe(true);
  });
  it("whitespace-only text is blank; real text and a real year count", () => {
    expect(degreeHasData(d({ ...blank, place: "  " }), "PG")).toBe(false);
    expect(degreeHasData(d({ ...blank, place: "Guntur" }), "PG")).toBe(true);
    expect(degreeHasData(d({ ...blank, yearOfPassing: 0 }), "UG")).toBe(false);
    expect(degreeHasData(d({ ...blank, yearOfPassing: 2013 }), "UG")).toBe(true);
    expect(degreeHasData(d({ ...blank, yearOfRegistration: 2019 }), "DOCTORAL")).toBe(true);
  });
  it("a Pursuing Ph.D. keeps its card (Status shows); a guide only counts while Pursuing", () => {
    expect(degreeHasData(d({ ...blank, status: "PURSUING" }), "DOCTORAL")).toBe(true);
    expect(degreeHasData(d({ ...blank, nameOfTheGuideSupervisor: "Dr X" }), "DOCTORAL")).toBe(false);
    expect(degreeHasData(d({ ...blank, status: "PURSUING", nameOfTheGuideSupervisor: "Dr X" }), "DOCTORAL")).toBe(true);
  });
  it("without a slot every stored key still counts", () => {
    expect(degreeHasData(d({ ...blank, yearOfAward: 2014 }))).toBe(true);
    expect(degreeHasData(undefined)).toBe(false);
  });
  it("the view renders nothing for the cleared cards and still shows real ones", () => {
    const html = (degree: DegreeDetail, level: "DOCTORAL" | "POST_DOCTORAL") => renderToStaticMarkup(createElement(DegreeView, { label: "X", level, degree }));
    expect(html(d({ ...blank, yearOfRegistration: 0 }), "DOCTORAL")).toBe("");
    expect(html(d({ ...blank, yearOfAward: 0 }), "POST_DOCTORAL")).toBe("");
    expect(html(d({ ...blank, status: "PURSUING", yearOfRegistration: 0 }), "DOCTORAL")).not.toContain("Year of Registration");
    expect(html(d({ ...blank, status: "PURSUING", yearOfRegistration: 2019 }), "DOCTORAL")).toContain("2019");
  });
});
