"use client";

// Starts an online payment and hands the browser to CCAvenue: the server makes the order and the
// encrypted request; the browser posts it to CCAvenue's checkout page as a normal form.
export async function payCertificateFeeOnline(requestId: string): Promise<void> {
  const res = await fetch("/api/college/payments/ccavenue/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: { kind: "CERTIFICATE", requestId } }),
  });
  const json = (await res.json().catch(() => ({}))) as { action?: string; fields?: Record<string, string>; error?: string };
  if (!res.ok || !json.action || !json.fields) throw new Error(json.error ?? "Couldn't start the payment");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = json.action;
  for (const [name, value] of Object.entries(json.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  INITIATED: "Not completed", SUCCESS: "Paid", FAILED: "Failed", ABORTED: "Cancelled", REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partly refunded",
};
export const PAYMENT_STATUS_CLASS: Record<string, string> = {
  INITIATED: "bg-muted text-muted-foreground", SUCCESS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", ABORTED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REFUNDED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200", PARTIALLY_REFUNDED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
};

/** Opens the fee receipt (laid out like the college's printed receipts) in a print window. */
export async function printFeeReceipt(url: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Allow pop-ups to print the receipt");
  win.document.write("<p style=\"font-family:sans-serif;padding:24px\">Preparing the receipt...</p>");
  try {
    const res = await fetch(url);
    const d = (await res.json()) as { payment?: import("@/types").Payment; college?: { name: string; place?: string; logoUrl?: string }; error?: string };
    if (!res.ok || !d.payment || !d.college) throw new Error(d.error ?? "Couldn't load the receipt");
    const { getFeeReceiptHTML } = await import("@/lib/pdf/feeReceiptTemplate");
    win.document.open();
    win.document.write(getFeeReceiptHTML({ payment: d.payment, college: d.college }));
    win.document.close();
    const img = win.document.querySelector("img");
    if (img && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 3000); });
    win.focus();
    win.print();
  } catch (e) {
    win.close();
    throw e;
  }
}
