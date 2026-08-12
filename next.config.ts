import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/securityHeaders";

/**
 * Next.js configuration.
 *
 * The only vendor wiring here is `next-intl`, and it is not vendor wiring in the
 * usual sense: it registers `src/i18n/request.ts` as the per-request i18n
 * configuration and needs no account, key, or network. Convex, Clerk, and
 * UploadThing are still absent, so `next build` succeeds with no secrets and no
 * cloud resources present — which remains this repository's rule for every
 * command in CI.
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * The build directory, overridable for a second concurrent dev server.
 *
 * Next.js 16 takes a lock at `<distDir>/lock` and refuses to start a second dev
 * server for the same directory. The end-to-end suite needs two — one with no
 * vendor configuration (the fresh-clone state) and one with local preview data
 * — so the second is given its own `distDir` rather than being dropped. Unset
 * everywhere else, so ordinary `pnpm dev` and `pnpm build` are unaffected.
 */
const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(distDir === undefined || distDir === "" ? {} : { distDir }),
  typescript: {
    // Type errors must never be silently tolerated; `pnpm typecheck` is the gate.
    ignoreBuildErrors: false,
  },

  /**
   * Response security headers on every route.
   *
   * The `/:path*` source covers pages, route handlers, and static assets alike.
   * The policy itself lives in `src/lib/securityHeaders.ts` with the reasoning
   * for each header, and is asserted by
   * `src/lib/securityHeaders.test.ts` — this file only decides *where* it
   * applies, because a config Next has to boot to inspect is a config nobody
   * checks.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
