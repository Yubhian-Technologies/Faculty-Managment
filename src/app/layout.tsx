import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SpeedInsights } from "@vercel/speed-insights/next";

// preload: false - the page already renders in Inter once it is used; preloading it
// made Chrome warn "preloaded but not used" on pages that paint text late (login
// redirects, dashboards behind auth) without any visible benefit.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", preload: false });

export const metadata: Metadata = {
  title: "Vishnu People",
  description: "End-to-end college automation platform for Vishnu institutions",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}
