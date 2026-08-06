// Shared across the landing page's Navbar, Hero and Footer — keep the logo
// asset in one place (same source the existing login page uses).
export const VISHNU_LOGO_URL =
  "https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png";

/** Every "Login" entry point on the public landing page routes here — the app's
 *  own sign-in page. Internal route, so link to it with next/link rather than a
 *  plain <a>, to get client-side navigation instead of a full page reload. */
export const LOGIN_URL = "/login";

export const NAV_SECTIONS = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "features", label: "Features" },
  { id: "contact", label: "Contact" },
] as const;
