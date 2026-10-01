// The letterhead logo for timetable exports.
//
// A college's own configured logo (collegeInfo.logoUrl) wins; when none is set
// the bundled Vishnu logo (public/vishnulogo.png, served same-origin) is used,
// so a timetable never goes out with an empty letterhead.

export const DEFAULT_TIMETABLE_LOGO_PATH = "/vishnulogo.png";

/** `logoUrl` if given, else the bundled logo as an absolute URL (absolute so it
 *  also resolves inside the print window and the off-screen PDF iframe). */
export function resolveLogoUrl(logoUrl?: string | null): string {
  const own = logoUrl?.trim();
  if (own) return own;
  return typeof window !== "undefined" ? `${window.location.origin}${DEFAULT_TIMETABLE_LOGO_PATH}` : DEFAULT_TIMETABLE_LOGO_PATH;
}

export interface ExcelLogo {
  base64: string; // data URL, as ExcelJS's addImage accepts
  extension: "png" | "jpeg";
  /** natural size in px, used to keep the aspect ratio when placing it */
  width: number;
  height: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    // Firebase Storage has no CORS policy for this app, so it goes through the
    // same-origin proxy the PDF renderer already uses.
    const target = url.startsWith("https://firebasestorage.googleapis.com/")
      ? `/api/pdf/image-proxy?url=${encodeURIComponent(url)}`
      : url;
    const res = await fetch(target);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith("image/") ? blob : null;
  } catch {
    return null;
  }
}

/** The logo as something ExcelJS can embed, or null. Never throws: a logo that
 *  can't be fetched (blocked, offline, unsupported type) must not take the
 *  whole spreadsheet download down with it. Tries the college's own logo first,
 *  then the bundled one. */
export async function loadExcelLogo(logoUrl?: string | null): Promise<ExcelLogo | null> {
  const candidates = [logoUrl?.trim(), resolveLogoUrl(null)].filter((u): u is string => !!u);
  for (const url of candidates) {
    const blob = await fetchBlob(url);
    if (!blob) continue;
    // ExcelJS embeds png / jpeg / gif; anything else (svg, webp) is skipped.
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpeg" : null;
    if (!extension) continue;
    try {
      const base64 = await blobToDataUrl(blob);
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return { base64, extension, ...size };
    } catch {
      continue;
    }
  }
  return null;
}
