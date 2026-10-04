import { describe, expect, it } from "vitest";
import { buildCsvText } from "./index";

describe("buildCsvText (exportToCSV)", () => {
  const cols = [{ key: "name", header: "Name" }, { key: "phone", header: "Phone" }];

  it("neutralises formula cells but leaves phones and numbers alone", () => {
    const csv = buildCsvText([{ name: "=HYPERLINK(\"http://x\")", phone: "+91 98765 43210" }, { name: "@SUM(A1)", phone: -5 }], cols);
    expect(csv).toBe('Name,Phone\n"\'=HYPERLINK(""http://x"")","+91 98765 43210"\n"\'@SUM(A1)","-5"');
  });

  it("writes null/undefined as empty and keeps quoting", () => {
    expect(buildCsvText([{ name: null, phone: 'a"b' }], cols)).toBe('Name,Phone\n"","a""b"');
  });
});
