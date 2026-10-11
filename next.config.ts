import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";

import {
  releaseProvenanceHeaders,
  sameOriginReferenceFrameHeaders,
  securityHeaders,
} from "./src/lib/securityHeaders";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
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
        headers: [
          ...securityHeaders(process.env.NODE_ENV === "production"),
          ...releaseProvenanceHeaders(process.env.RELEASE_SHA),
        ],
      },
      {
        source: "/f1-f2-reference/:path*",
        headers: sameOriginReferenceFrameHeaders(
          process.env.NODE_ENV === "production",
        ),
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

const localizedConfig = withNextIntl(nextConfig);
export default process.env.SENTRY_ENABLED === "1" &&
process.env.SENTRY_AUTH_TOKEN &&
process.env.SENTRY_ORG &&
process.env.SENTRY_PROJECT
  ? withSentryConfig(localizedConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      buildTimeInstrumentation: false,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      ...(process.env.RELEASE_SHA
        ? { release: { name: process.env.RELEASE_SHA } }
        : {}),
      webpack: {
        autoInstrumentServerFunctions: false,
        autoInstrumentMiddleware: false,
        autoInstrumentAppDirectory: false,
      },
    })
  : localizedConfig;
