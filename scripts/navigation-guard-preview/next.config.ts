import path from "node:path";
import type { NextConfig } from "next";

const root = path.resolve(import.meta.dirname, "../..");
const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  poweredByHeader: false,
  turbopack: {
    root,
    resolveAlias: {
      // Keep the real storage caller/foregrounds, with synthetic permissions
      // and a mutation boundary that cannot contact any backend.
      "@/components/providers/WorkspaceProvider": "./storageWorkspaceStub.ts",
      "convex/react": "./storageConvexStub.ts",
      "@/*": "../../src/*",
      "next-intl/config": "../../src/i18n/request.ts",
    },
  },
};
export default config;
