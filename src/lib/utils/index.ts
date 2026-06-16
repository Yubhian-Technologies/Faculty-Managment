import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Timestamp } from "firebase/firestore";
import type { WorkflowStatus, CandidateStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type FirestoreTimestampLike = { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };

function toDate(timestamp: Timestamp | Date | FirestoreTimestampLike | null | undefined): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof (timestamp as Timestamp).toDate === "function") return (timestamp as Timestamp).toDate();
  // Admin SDK serialises to { _seconds, _nanoseconds } or { seconds, nanoseconds }
  const secs = (timestamp as { _seconds?: number; seconds?: number })._seconds
    ?? (timestamp as { seconds?: number }).seconds;
  if (typeof secs === "number") return new Date(secs * 1000);
  return null;
}

export function formatDate(timestamp: Timestamp | Date | FirestoreTimestampLike | null | undefined): string {
  const date = toDate(timestamp);
  if (!date) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(timestamp: Timestamp | Date | FirestoreTimestampLike | null | undefined): string {
  const date = toDate(timestamp);
  if (!date) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getWorkflowStatusColor(status: WorkflowStatus | CandidateStatus): string {
  const colorMap: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
    APPROVED: "bg-green-100 text-green-800 border-green-200",
    REJECTED: "bg-red-100 text-red-800 border-red-200",
    MODIFIED: "bg-orange-100 text-orange-800 border-orange-200",
    IN_PROGRESS: "bg-blue-100 text-blue-800 border-blue-200",
    COMPLETED: "bg-green-100 text-green-800 border-green-200",
    WAITLISTED: "bg-purple-100 text-purple-800 border-purple-200",
    SHORTLISTED: "bg-blue-100 text-blue-800 border-blue-200",
    ARRIVED: "bg-teal-100 text-teal-800 border-teal-200",
  };
  return colorMap[status] ?? "bg-gray-100 text-gray-800 border-gray-200";
}

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  columns: { key: string; header: string }[]
): void {
  const headers = columns.map((c) => c.header).join(",");
  const rows = data.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        const str = val === null || val === undefined ? "" : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  const csv = [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "…";
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
