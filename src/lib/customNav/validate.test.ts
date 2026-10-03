import { describe, expect, it } from "vitest";
import { isSafeHref, isSafeImageUrl, pageUpdateSchema, orderSchema } from "./validate";

describe("isSafeHref", () => {
  it("accepts in-app paths and http(s) links", () => {
    for (const ok of ["/hod/faculty", "/pages/abc", "https://example.com/a?b=1", "http://example.com"]) expect(isSafeHref(ok)).toBe(true);
  });
  it("rejects script, data, protocol-relative and malformed targets", () => {
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "//evil.com", "/\\evil.com", "mailto:a@b.c", "ftp://x.y", "", "hod/faculty", "https://"]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
  });
});

describe("isSafeImageUrl", () => {
  it("allows only http(s) images", () => {
    expect(isSafeImageUrl("https://x.test/a.png")).toBe(true);
    expect(isSafeImageUrl("/local.png")).toBe(false);
    expect(isSafeImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeImageUrl("javascript:1")).toBe(false);
  });
});

const meta = { title: "Notices", iconName: "Bell", roles: ["HOD"], enabled: true };

describe("pageUpdateSchema", () => {
  it("accepts every block type", () => {
    const r = pageUpdateSchema.safeParse({
      ...meta,
      blocks: [
        { id: "a", type: "heading", text: "Hi", level: 1 },
        { id: "b", type: "text", text: "Body" },
        { id: "c", type: "button", label: "Go", href: "/hod/faculty", variant: "primary" },
        { id: "d", type: "image", url: "https://x.test/i.png", alt: "" },
        { id: "e", type: "divider" },
        { id: "f", type: "linkList", links: [{ label: "A", href: "https://a.test" }] },
        { id: "g", type: "infoCard", title: "T", body: "B", tone: "warning" },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unsafe button link, duplicate block ids, unknown roles and unknown icons", () => {
    const bad = (extra: object) => pageUpdateSchema.safeParse({ ...meta, blocks: [], ...extra }).success;
    expect(bad({ blocks: [{ id: "a", type: "button", label: "x", href: "javascript:alert(1)", variant: "primary" }] })).toBe(false);
    expect(bad({ blocks: [{ id: "a", type: "divider" }, { id: "a", type: "divider" }] })).toBe(false);
    expect(bad({ roles: ["NOT_A_ROLE"] })).toBe(false);
    expect(bad({ iconName: "NoSuchIcon" })).toBe(false);
    expect(bad({ title: "" })).toBe(false);
  });
});

describe("orderSchema", () => {
  it("needs a known role and hrefs starting with /", () => {
    expect(orderSchema.safeParse({ role: "HOD", order: ["/hod/faculty", "/pages/x"] }).success).toBe(true);
    expect(orderSchema.safeParse({ role: "HOD", order: ["hod"] }).success).toBe(false);
    expect(orderSchema.safeParse({ role: "NOPE", order: [] }).success).toBe(false);
  });
});
