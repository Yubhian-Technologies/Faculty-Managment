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
