import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import path from "node:path";

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

  webpack(config, { dev }) {
    if (dev) {
      // Recording frames and review notes must not re-emit chunks during refresh.
      // Preserve Next's existing node_modules/.git/.next exclusions.
      const previous = config.watchOptions?.ignored;
      const root = process.cwd().replaceAll(path.sep, "/");
      const folders = ["artifacts", ".cache", "docs/plans"];
      const ignored =
        previous instanceof RegExp
          ? new RegExp(
              `${previous.source}|^(?:${folders
                .map((folder) =>
                  `${root}/${folder}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                )
                .join("|")})(?:/|$)`,
              previous.flags,
            )
          : [
              ...(Array.isArray(previous)
                ? previous
                : previous
                  ? [previous]
                  : []),
              ...folders.map((folder) => `${root}/${folder}/**`),
            ];
      config.watchOptions = { ...config.watchOptions, ignored };
    }
    return config;
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/th/master-data/storage-layouts/n575kryc3hp4e788hyc7pab4",
        destination:
          "/th/master-data/storage-layouts/n575kryc3hp4e788hyc7pab4hh8f1vgv",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
