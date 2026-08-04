// Shared across the landing page's Navbar, Hero and Footer — keep the logo
// asset in one place (same source the existing login page uses).
export const VISHNU_LOGO_URL =
  "https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png";

/** Every "Login" entry point on the public landing page sends visitors to the
 *  main Vishnu People site rather than this app's own /login route. */
export const LOGIN_URL = "https://vishnupeople.in";

export const NAV_SECTIONS = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "features", label: "Features" },
  { id: "contact", label: "Contact" },
] as const;
