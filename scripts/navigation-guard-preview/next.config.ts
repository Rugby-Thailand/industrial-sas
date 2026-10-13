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
      "@/*": "../../src/*",
      "next-intl/config": "../../src/i18n/request.ts",
    },
  },
};
export default config;
