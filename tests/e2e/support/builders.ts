// Request-body builders for the budget/indent APIs — kept in one place so
// every spec file uses realistic, schema-valid payloads (matching the
// validation in src/app/api/college/budget-requests/route.ts and
// src/app/api/college/indent-requests/route.ts) without repeating the
// item/category shape everywhere.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function nonRecurringGroup(title = "Playwright Lab Equipment") {
  return {
    id: `grp-${unique()}`,
    category: "Lab Equipment",
    items: [
      {
        id: `item-${unique()}`,
        title,
        description: "Automated test fixture item",
        price: 15000,
        extras: { quantity: "2" },
      },
    ],
  };
}

export function recurringGroup(title = "Playwright Guest Lecture") {
  return {
    id: `grp-${unique()}`,
    category: "Guest Faculty/Guest Lectures",
    items: [
      {
        id: `item-${unique()}`,
        title,
        description: "Automated test fixture item",
        price: 5000,
        extras: { quantity: "1" },
      },
    ],
  };
}

export function regularBudgetRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    academicYear: "2026-27",
    title: `Playwright Regular Budget ${unique()}`,
    nonRecurring: [nonRecurringGroup()],
    recurring: [],
    ...overrides,
  };
}

export function emergencyBudgetRequestBody(
  kind: "GOODS" | "NON_GOODS",
  overrides: Record<string, unknown> = {}
) {
  return {
    isEmergency: true,
    department: "Mechanical Engineering",
    emergencyReason: "Automated test — critical equipment failure",
    academicYear: "2026-27",
    title: `Playwright Emergency ${kind} ${unique()}`,
    nonRecurring: kind === "GOODS" ? [nonRecurringGroup()] : [],
    recurring: kind === "NON_GOODS" ? [recurringGroup()] : [],
    ...overrides,
  };
}

export function indentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: `item-${unique()}`,
    description: "A4 printer paper (Playwright)",
    quantity: 10,
    estimatedUnitPrice: 250,
    ...overrides,
  };
}

export function goodsIndentBody(overrides: Record<string, unknown> = {}) {
  return {
    title: `Playwright Goods Indent ${unique()}`,
    category: "Lab Equipment",
    requestType: "GOODS",
    items: [indentItem()],
    ...overrides,
  };
}

export function nonGoodsIndentBody(overrides: Record<string, unknown> = {}) {
  return {
    title: `Playwright Non-Goods Indent ${unique()}`,
    category: "Guest Faculty/Guest Lectures",
    requestType: "NON_GOODS",
    items: [indentItem({ description: "Guest lecture honorarium (Playwright)" })],
    ...overrides,
  };
}

export function quotation(vendorName: string, price: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `quote-${unique()}`,
    vendorName,
    termsAndConditions: "Net 30, delivery within 2 weeks",
    price,
    expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ...overrides,
  };
}

export function threeQuotations() {
  return [
    quotation("Playwright Vendor A", 2600),
    quotation("Playwright Vendor B", 2500),
    quotation("Playwright Vendor C", 2750),
  ];
}
