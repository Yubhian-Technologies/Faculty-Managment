import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersonalDetailsFields, getMissingRequiredPersonalFields, type PersonalDetailsValue } from "./PersonalDetailsFields";

// Which Ratification fields the Faculty form shows for each stored status (static render: the labels
// are plain text, so their presence is the visible/hidden state).
const render = (value: PersonalDetailsValue, ratificationHistory = true) =>
  renderToStaticMarkup(createElement(PersonalDetailsFields, { value, onChange: () => {}, ratificationHistory }));
const shows = (html: string) => ({
  result: html.includes("Ratification Decision"),
  designation: html.includes("Ratified Designation"),
  proceedings: html.includes("Ratification Proceedings Number"),
  date: html.includes("Ratification Date"),
  records: html.includes("Ratification Records"),
});

describe("Ratification form - which fields show", () => {
  it("Not Yet Attended: only the Status", () => {
    expect(shows(render({ ratificationStatus: "Not Yet Attended" }))).toEqual({ result: false, designation: false, proceedings: false, date: false, records: false });
  });
  it("blank status: only the Status", () => {
    expect(shows(render({ ratificationStatus: "" }))).toEqual({ result: false, designation: false, proceedings: false, date: false, records: false });
  });
  it("Attended (result not chosen yet): Status + Result, no details", () => {
    expect(shows(render({ ratificationStatus: "Attended" }))).toEqual({ result: true, designation: false, proceedings: false, date: false, records: false });
  });
  it("Attended + Not Ratified: Status + Decision, details hidden", () => {
    expect(shows(render({ ratificationStatus: "Not Ratified" }))).toEqual({ result: true, designation: false, proceedings: false, date: false, records: false });
  });
  it("Attended + Ratified: Result and the details - one record is on screen by default, even with none on file", () => {
    expect(shows(render({ ratificationStatus: "Ratified", ratifications: [] }))).toEqual({ result: true, designation: true, proceedings: true, date: true, records: true });
    expect(shows(render({ ratificationStatus: "Ratified" })).designation).toBe(true);
  });
  it("Ratified with 3 records on file shows all 3", () => {
    const rows = [1, 2, 3].map((n) => ({ designation: "Professor", proceedingsNumber: `P-${n}`, date: "2020-01-01" }));
    const html = render({ ratificationStatus: "Ratified", ratifications: rows });
    expect(html.match(/Ratified Designation/g)).toHaveLength(3);
    for (const n of [1, 2, 3]) expect(html).toContain(`P-${n}`);
  });
  it("a stray stored value ('Not Applicable'): no Decision, no details (shown as it is, not guessed)", () => {
    expect(shows(render({ ratificationStatus: "Not Applicable" }))).toEqual({ result: false, designation: false, proceedings: false, date: false, records: false });
  });
  it("staff / user records (no history list) keep the single Proceedings Number + Date, only when Ratified", () => {
    const ratified = shows(render({ ratificationStatus: "Ratified" }, false));
    expect(ratified).toMatchObject({ result: true, designation: false, proceedings: true, date: true, records: false });
    expect(shows(render({ ratificationStatus: "Not Ratified" }, false)).proceedings).toBe(false);
  });
});

describe("Ratification validation", () => {
  const base = { legalName: "A", gender: "Male", dateOfBirth: "1990-01-01", aadharNo: "123456789012", panNo: "ABCDE1234F" };
  const missing = (ratificationStatus: string) => getMissingRequiredPersonalFields({ ...base, ratificationStatus });
  it("blank status is missing", () => expect(missing("")).toEqual(["Ratification Status"]));
  it("Attended without a result is missing the Result", () => expect(missing("Attended")).toEqual(["Ratification Decision"]));
  it.each(["Not Yet Attended", "Ratified", "Not Ratified"])("%s is complete", (s) => expect(missing(s)).toEqual([]));
});
