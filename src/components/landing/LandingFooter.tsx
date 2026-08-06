"use client";

import { Mail, Phone } from "lucide-react";
import { RuixenGradientFooter } from "@/components/ui/ruixen-gradient-footer";
import { VISHNU_LOGO_URL } from "./constants";

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const QUICK_LINKS = [
  { id: "about", label: "About" },
  { id: "features", label: "Features" },
  { id: "contact", label: "Contact" },
];

/** The component's default stops are a rainbow; these keep the glow inside the
 *  palette already in use — foreground slate, primary blue, the hero accent and
 *  the pillars' blue-50 — fading out at the top. Floor (0) → top (1). */
const GLOW_STOPS = [
  { offset: 0, color: "#0F172A" }, // --foreground, so the glow rises out of the footer
  { offset: 0.2, color: "#1D4ED8" }, // --primary
  { offset: 0.42, color: "#2563EB" }, // blue-600, the pillar accent
  { offset: 0.64, color: "#4A9EFF" }, // hero kinetic-grid accent
  { offset: 0.84, color: "#EFF6FF" }, // blue-50, the pillars panel
  { offset: 1, color: "#EFF6FF00" },
];

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    // id lives on a plain wrapper: the nav's "Contact" link and its
    // IntersectionObserver both target #contact, and RuixenGradientFooter
    // renders the <footer> itself. A plain div also keeps the pinned glow from
    // being captured by a transformed ancestor.
    <div id="contact">
      <RuixenGradientFooter
        gradientHeight="40vh"
        // 0 keeps the glow hidden until the last screen instead of leaving a
        // strip pinned over the light sections for the whole page.
        minReveal={0}
        stops={GLOW_STOPS}
        className="border-t border-border/60 bg-foreground text-background"
      >
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <img src={VISHNU_LOGO_URL} alt="Vishnu People logo" className="h-9 w-9 object-contain" />
                <span className="text-lg font-bold text-background">Vishnu People</span>
              </div>
              <p className="mt-3 max-w-xs text-sm text-background/70">
                A unified digital platform connecting students, parents, faculty and
                administrators of Vishnu institutions.
              </p>
            </div>
  
            <div>
              <p className="text-sm font-semibold text-background">Quick Links</p>
              <ul className="mt-4 space-y-2.5">
                {QUICK_LINKS.map((link) => (
                  <li key={link.id}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(link.id)}
                      className="text-sm text-background/70 transition-colors hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
  
            <div>
              <p className="text-sm font-semibold text-background">Legal</p>
              <ul className="mt-4 space-y-2.5">
                <li className="text-sm text-background/70">Privacy Policy</li>
                <li className="text-sm text-background/70">Terms &amp; Conditions</li>
              </ul>
            </div>
  
            <div>
              <p className="text-sm font-semibold text-background">Get in Touch</p>
              <ul className="mt-4 space-y-2.5">
                <li className="flex items-center gap-2 text-sm text-background/70">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  info@vishnu.edu.in
                </li>
                <li className="flex items-center gap-2 text-sm text-background/70">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden />
                  +91 00000 00000
                </li>
              </ul>
            </div>
          </div>
  
          <div className="mt-12 border-t border-background/10 pt-6 text-center text-xs text-background/60">
            © {year} Vishnu People. All rights reserved.
          </div>
        </div>
      </RuixenGradientFooter>
    </div>
  );
}
