"use client";

import { Mail, Phone } from "lucide-react";
import { VISHNU_LOGO_URL } from "./constants";

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const QUICK_LINKS = [
  { id: "about", label: "About" },
  { id: "features", label: "Features" },
  { id: "contact", label: "Contact" },
];

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer id="contact" className="border-t border-border/60 bg-foreground text-background">
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
    </footer>
  );
}
