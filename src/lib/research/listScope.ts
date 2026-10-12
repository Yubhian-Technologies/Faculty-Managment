/**
 * Is this list request the R&D REVIEW QUEUE - every submission in the college -
 * or an ordinary "show me my own records" read?
 *
 * Who the caller is cannot answer that. The R&D head also has their own My Work
 * profile pages (/panel/profile/research and the rest), and those call the very
 * same endpoints as the /r-and-d review pages. Deciding from the role alone put
 * the whole college's rows on the R&D head's own profile: another person's
 * pending Research Profile was read back as `requests[0]` and rendered as the
 * viewer's own, badge, prefilled Edit form and all.
 *
 * So the PAGE says what it wants (`?scope=all`), and holding the R&D seat is
 * what decides whether it may have it. A caller who asks without the seat gets
 * their own rows, exactly as if they had not asked - this never grants access.
 */
export function wantsWholeCollege(request: Request, isRnD: boolean): boolean {
  return isRnD && new URL(request.url).searchParams.get("scope") === "all";
}
