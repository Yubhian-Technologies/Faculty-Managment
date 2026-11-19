import { describe, expect, it } from "vitest";
import { dmyTextToIso, isoToDmyText, typeDmy } from "./dateField";

describe("DD/MM/YYYY date box", () => {
  it("shows a stored date as DD/MM/YYYY and reads it back", () => {
    expect(isoToDmyText("2026-11-19")).toBe("19/11/2026");
    expect(isoToDmyText("")).toBe("");
    expect(dmyTextToIso("19/11/2026")).toBe("2026-11-19");
  });

  it("gives no value until the date is complete and real", () => {
    expect(dmyTextToIso("19/11/202")).toBe("");
    expect(dmyTextToIso("31/02/2026")).toBe("");
    expect(dmyTextToIso("29/02/2028")).toBe("2028-02-29");
    expect(dmyTextToIso("00/01/2026")).toBe("");
  });

  it("puts the slashes in while typing, and backspace over one works", () => {
    expect(typeDmy("1")).toBe("1");
    expect(typeDmy("19")).toBe("19");
    expect(typeDmy("191")).toBe("19/1");
    expect(typeDmy("19112026")).toBe("19/11/2026");
    expect(typeDmy("19/11/20261")).toBe("19/11/2026");
    expect(typeDmy("19/")).toBe("19");
    expect(typeDmy("5/11/2026")).toBe("05/11/2026");
    expect(typeDmy("5/1/2026")).toBe("05/01/2026");
    expect(typeDmy("19-11-2026")).toBe("19/11/2026");
  });
});

describe("one date style across the site", () => {
  it("no page builds its own full date (day + month + year) - they go through formatDate / dmy (DD/MM/YYYY)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
    const bad: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\.toLocale(?:Date)?String\(([^)]*)\)/g)) {
        const args = m[1];
        const fullDate = /day/.test(args) && /year/.test(args) && !/weekday/.test(args);
        const bareLocale = /^\s*("en-IN")?\s*$/.test(args) && m[0].startsWith(".toLocaleDateString");
        if (fullDate || bareLocale) bad.push(`${file.replace(process.cwd() + "/", "")}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
