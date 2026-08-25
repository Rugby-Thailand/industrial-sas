import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/securityHeaders";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(distDir === undefined || distDir === "" ? {} : { distDir }),
  typescript: {
    ignoreBuildErrors: false,
  },

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
