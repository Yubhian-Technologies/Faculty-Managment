import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  serverExternalPackages: ["puppeteer", "puppeteer-core", "@sparticuz/chromium", "firebase-admin"],
  // Ships @sparticuz/chromium's compressed Chromium binary into the serverless function
  // bundle for the PDF route — Vercel's file tracer doesn't always pick up native/binary
  // assets on its own. See src/lib/pdf/renderPdf.ts for how it's used.
  outputFileTracingIncludes: {
    "/api/pdf/generate": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
