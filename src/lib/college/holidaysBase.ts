// The holidays screens are shared by Academics, College Office and Principal / Vice Principal;
// links inside them stay in whichever area the person opened them from.
export function holidaysBaseFor(pathname: string | null): string {
  if (pathname?.startsWith("/college-office")) return "/college-office/holidays";
  if (pathname?.startsWith("/principal")) return "/principal/holiday-calendar";
  return "/academics/holidays";
}
