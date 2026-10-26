// Same logo used across every generated document (offer/appointment letters,
// document acknowledgement, candidate profile) and the login page - one place
// to change it instead of N copies of the same Cloudinary URL.
export const VISHNU_LOGO_URL =
  "https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png";

/** Logo src for a generated document: the college's own uploaded logo (Firebase
 *  Storage only) when given, otherwise the default Vishnu logo. */
export function logoSrc(url?: string | null): string {
  const u = url?.trim() ?? "";
  return u.startsWith("https://firebasestorage.googleapis.com/") ? u.replace(/["<>\s]/g, "") : VISHNU_LOGO_URL;
}

/** The signed-in college's own logo URL for documents, or undefined when it uses the default. Never throws. */
export async function fetchCollegeLogoUrl(): Promise<string | undefined> {
  try {
    const res = await fetch("/api/college/info");
    if (!res.ok) return undefined;
    const d = (await res.json()) as { hasCustomLogo?: boolean; logoUrl?: string };
    return d.hasCustomLogo ? d.logoUrl : undefined;
  } catch {
    return undefined;
  }
}
