import { describe, expect, it } from "vitest";
import { parseHtmlTable } from "./parseWordTable";

describe("parseHtmlTable", () => {
  it("reads a plain grid with no spans", () => {
    const html = `
      <table>
        <tr><td></td><td>Monday</td></tr>
        <tr><td>Period 1</td><td>CS201 / Dr. Rao</td></tr>
      </table>`;
    const grid = parseHtmlTable(html);
    expect(grid.rowCount).toBe(2);
    expect(grid.colCount).toBe(2);
    expect(grid.cells.find((c) => c.row === 1 && c.col === 1)).toMatchObject({
      rowSpan: 1, colSpan: 1, text: "CS201 / Dr. Rao",
    });
  });

  it("preserves a <br> line break as a splittable newline", () => {
    const html = `<table><tr><td>Data Structures<br>Dr. Rao</td></tr></table>`;
    const grid = parseHtmlTable(html);
    expect(grid.cells[0].text).toBe("Data Structures\nDr. Rao");
  });

  it("joins separate <p> paragraphs within a cell as lines", () => {
    const html = `<table><tr><td><p>Data Structures</p><p>Dr. Rao</p></td></tr></table>`;
    const grid = parseHtmlTable(html);
    expect(grid.cells[0].text).toBe("Data Structures\nDr. Rao");
  });

  it("expands rowspan/colspan the way a browser lays the table out", () => {
    // A 2-period lab block (rowspan=2) in column 1, with a normal cell
    // to its right on the second row landing in column 2, not column 1.
    const html = `
      <table>
        <tr><td></td><td>Monday</td><td>Tuesday</td></tr>
        <tr><td>Period 1</td><td rowspan="2">CS301 Lab / Kiran</td><td>CS202 / Babu</td></tr>
        <tr><td>Period 2</td><td>CS203 / Rao</td></tr>
      </table>`;
    const grid = parseHtmlTable(html);
    const lab = grid.cells.find((c) => c.text === "CS301 Lab / Kiran")!;
    expect(lab).toMatchObject({ row: 1, col: 1, rowSpan: 2, colSpan: 1 });
    // The 2nd row's second real <td> ("CS203 / Rao") must land at col 2,
    // not col 1 - it has to skip over the rowspan cell still occupying col 1.
    const secondRowSecondCell = grid.cells.find((c) => c.text === "CS203 / Rao")!;
    expect(secondRowSecondCell).toMatchObject({ row: 2, col: 2 });
  });

  it("picks the table with the most cells when a document has more than one", () => {
    const html = `
      <table><tr><td>Department of CSE</td></tr></table>
      <table>
        <tr><td></td><td>Monday</td></tr>
        <tr><td>Period 1</td><td>CS201 / Dr. Rao</td></tr>
      </table>`;
    const grid = parseHtmlTable(html);
    expect(grid.rowCount).toBe(2);
    expect(grid.cells.some((c) => c.text === "CS201 / Dr. Rao")).toBe(true);
  });

  it("throws when the document has no table at all", () => {
    expect(() => parseHtmlTable("<p>No table here</p>")).toThrow();
  });
});
