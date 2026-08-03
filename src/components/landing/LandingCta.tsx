"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "./Reveal";

export function LandingCta() {
  return (
    <section id="get-started" className="relative overflow-hidden bg-primary py-20 sm:py-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="landing-blob absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div
          className="landing-blob absolute -bottom-24 -right-10 h-80 w-80 rounded-full bg-white/10 blur-3xl"
          style={{ animationDelay: "4s" }}
        />
      </div>

      <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
          Ready to Get Started?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-primary-foreground/85 sm:text-lg">
          Login to access your personalized dashboard.
        </p>
        <div className="mt-8">
          <Button asChild size="lg" variant="secondary" className="shadow-lg">
            <Link href="/login">
              Login Now
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Reveal>
    </section>
  );
}
