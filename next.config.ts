import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Turbopack walks up
  // looking for a lockfile and finds a stray one in the parent folder (which
  // also contains unrelated sibling projects), making it treat that parent
  // directory as the root — watching/resolving far more than needed and
  // slowing down dev. See node_modules/next/dist/docs/.../turbopack.md.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Baseline response headers. Deliberately not a full Content-Security-Policy: the app loads
  // map tiles, fonts, Firebase and face-model assets from several hosts, and a strict policy
  // needs a report-only trial first. These are the ones that are safe to enforce today.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          // Attendance needs the camera and location; nothing else needs any device access.
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },
  serverExternalPackages: ["puppeteer", "puppeteer-core", "@sparticuz/chromium", "firebase-admin"],
  // Ships @sparticuz/chromium's compressed Chromium binary into the serverless function
  // bundle for the PDF route - Vercel's file tracer doesn't always pick up native/binary
  // assets on its own. See src/lib/pdf/renderPdf.ts for how it's used.
  outputFileTracingIncludes: {
    "/api/pdf/generate": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
