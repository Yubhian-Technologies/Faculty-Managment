"use client";

import { LandingNavbar } from "./LandingNavbar";
import { LandingHero } from "./LandingHero";
import { LandingStats } from "./LandingStats";
import { LandingFeatures } from "./LandingFeatures";
import { LandingWhyUs } from "./LandingWhyUs";
import { LandingTestimonials } from "./LandingTestimonials";
import { LandingCta } from "./LandingCta";
import { LandingFooter } from "./LandingFooter";

/** Public marketing page shown at "/" to unauthenticated visitors, before the
 *  existing login flow. Purely presentational — every "Login" entry point
 *  routes to the existing /login page; no auth/session logic lives here. */
export function LandingPage() {
  return (
    <div className="landing-page min-h-screen bg-background">
      <LandingNavbar />
      <main>
        <LandingHero />
        <LandingStats />
        <LandingWhyUs />
        <LandingFeatures />
        <LandingTestimonials />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
