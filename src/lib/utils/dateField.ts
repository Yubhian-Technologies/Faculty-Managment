// Text rules of the DD/MM/YYYY date box (components/ui/date-field.tsx). Pure, so they are tested.

/** "2026-11-19" -> "19/11/2026"; anything else -> "". */
export function isoToDmyText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "19/11/2026" -> "2026-11-19" when it is a real calendar date; "" otherwise (incomplete, 31/02/2026 ...). */
export function dmyTextToIso(text: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number(yyyy) < 1000 || d.getUTCFullYear() !== Number(yyyy) || d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) return "";
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * What the box shows for what was typed: digits only, at most 8, slashes put in as the next part starts ("191" ->
 * "19/1"), so backspacing over a slash works. A single-digit day / month typed with a slash ("5/" -> "05/") is padded.
 */
export function typeDmy(raw: string): string {
  // "5/11/2026" or "5/1/2026": pad a part the person closed with a slash early.
  const parts = raw.split(/[/\-.\s]/);
  let digits = "";
  if (parts.length > 1) {
    parts.forEach((p, i) => {
      const d = p.replace(/\D/g, "");
      digits += i < 2 && i < parts.length - 1 && d.length === 1 ? `0${d}` : d;
    });
  } else {
    digits = raw.replace(/\D/g, "");
  }
  digits = digits.slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
