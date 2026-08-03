import type { NextConfig } from "next";

/**
 * Scaffold-stage Next.js configuration.
 *
 * Deliberately free of vendor wiring: no Convex, Clerk, UploadThing, next-intl
 * plugin, or PWA configuration is registered yet, so `next build` succeeds with
 * no secrets and no cloud resources present.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Type errors must never be silently tolerated; `pnpm typecheck` is the gate.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
