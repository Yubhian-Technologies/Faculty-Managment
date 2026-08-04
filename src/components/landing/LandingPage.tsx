"use client";

import { LandingNavbar } from "./LandingNavbar";
import { LandingHero } from "./LandingHero";
import { LandingFeatures } from "./LandingFeatures";
import { LandingAbout } from "./LandingAbout";
import { LandingTestimonials } from "./LandingTestimonials";
import { LandingCta } from "./LandingCta";
import { LandingFooter } from "./LandingFooter";

/** Public marketing page shown at "/" to unauthenticated visitors, before the
 *  existing login flow. Purely presentational — every "Login" entry point
 *  leaves for LOGIN_URL (see ./constants); no auth/session logic lives here. */
export function LandingPage() {
  return (
    <div className="landing-page min-h-screen bg-background">
      <LandingNavbar />
      <main>
        <LandingHero />
        <LandingAbout />
        <LandingFeatures />
        <LandingTestimonials />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
