import { describe, expect, it } from "vitest";
import { externalHref } from "./externalHref";

describe("externalHref", () => {
  it("passes a real address through untouched", () => {
    expect(externalHref("https://doi.org/10.1007/978-3-031-71758-1")).toBe("https://doi.org/10.1007/978-3-031-71758-1");
    expect(externalHref("http://example.org/a?b=1#c")).toBe("http://example.org/a?b=1#c");
    expect(externalHref("  https://example.org/x  ")).toBe("https://example.org/x");
  });

  it("completes a bare host, which is what was meant", () => {
    expect(externalHref("doi.org/10.1007/978-0-387-84858-7")).toBe("https://doi.org/10.1007/978-0-387-84858-7");
    expect(externalHref("www.springer.com/book")).toBe("https://www.springer.com/book");
    expect(externalHref("link.springer.com")).toBe("https://link.springer.com");
  });

  // The reported bug: these became in-app paths and landed on "Unknown section."
  it("refuses a value that is not a link at all", () => {
    expect(externalHref("ds")).toBeNull();
    expect(externalHref("dcs")).toBeNull();
    expect(externalHref("tgdfsz")).toBeNull();
    expect(externalHref("2RC")).toBeNull();
  });

  it("refuses anything with whitespace in it", () => {
    expect(externalHref("my book link")).toBeNull();
    expect(externalHref("doi.org/10.1 007")).toBeNull();
  });

  it("refuses a host that is not one", () => {
    expect(externalHref("example.")).toBeNull();
    expect(externalHref(".org")).toBeNull();
    expect(externalHref("/panel/profile")).toBeNull();
  });

  it("is null for nothing", () => {
    expect(externalHref("")).toBeNull();
    expect(externalHref("   ")).toBeNull();
    expect(externalHref(undefined)).toBeNull();
    expect(externalHref(null)).toBeNull();
  });
});
