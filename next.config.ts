import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
  // Baseline response headers. A full Content-Security-Policy is trialled report-only below: the app
  // loads map tiles, fonts, Firebase and face-model assets from several hosts. The rest are safe to enforce today.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          // Report-only trial of a fuller policy: violations show in the browser console but nothing
          // is blocked. Tighten script-src/connect-src from what it reports, then enforce.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
              "style-src 'self' 'unsafe-inline' https:",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https:",
              "connect-src 'self' https: wss:",
              "worker-src 'self' blob:",
              "frame-src 'self' https://*.firebaseapp.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
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
