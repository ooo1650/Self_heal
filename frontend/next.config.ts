import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone — required for the multi-stage Docker build.
  output: "standalone",

  // Inject build-time env vars. NEXT_PUBLIC_* vars are inlined into the JS
  // bundle at build time. BUILD_TIME gives a human-readable timestamp so you
  // can confirm the deployed version is current without digging into logs.
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
