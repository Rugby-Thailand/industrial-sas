import next from "eslint-config-next";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";
import navigation from "./scripts/eslint/navigation.mjs";

const publicBuilders = [
  "query",
  "mutation",
  "action",
  "httpAction",
  "queryGeneric",
  "mutationGeneric",
  "actionGeneric",
  "httpActionGeneric",
];
const rawBuilders = (allowed = []) => [
  "error",
  {
    patterns: [
      {
        // `/./` and `//` resolve to the same module; module-boundaries normalizes the rest.
        regex:
          "^(?:convex/server|(?:.*[/])?_generated(?:/+\\.)*/+server(?:\\.js)?)$",
        importNames: publicBuilders.filter((name) => !allowed.includes(name)),
        allowTypeImports: true,
        message: "Use tenant wrappers for public Convex functions.",
      },
    ],
  },
];
const dropdowns = {
  patterns: [
    {
      group: [
        "**/ui/select",
        "./select",
        "../select",
        "@radix-ui/react-select",
      ],
      message: "Use SelectControl for application dropdowns.",
    },
  ],
  paths: [
    {
      name: "radix-ui",
      importNames: ["Select"],
      message: "Use SelectControl for application dropdowns.",
    },
  ],
};
const frontendImports = (entry, dropdown = true) => [
  "error",
  {
    paths: dropdown ? dropdowns.paths : [],
    patterns: [
      ...(dropdown ? dropdowns.patterns : []),
      {
        regex: `(?:^|/)jobScan(?:$|/${entry ? `(?!${entry}(?:\\.[jt]sx?)?$)` : ""})`,
        message:
          "Job-scan internals are private; share domain rules through convex/model.",
      },
    ],
  },
];

/**
 * Flat ESLint configuration.
 *
 * `eslint-config-next` already bundles the Next.js, React, React Hooks,
 * jsx-a11y, import, and typescript-eslint recommended layers. `prettier` is
 * applied last so formatting is owned exclusively by Prettier.
 */
export default tseslint.config(
  {
    ignores: [
      // Official downloaded skill payload; keep vendor sources untouched.
      ".agents/skills/impeccable/**",
      ".cache/**",
      // Local scratch and nested checkouts are not maintained project inputs.
      ".claude/worktrees/**",
      ".claude-worktrees/**",
      "tmp/**",
      "temp/**",
      // Archived, one-off review probes; maintained capture tools still lint.
      "docs/reviews/**/probes/**",
      "docs/reviews/**/*.probe.{js,mjs,cjs,ts,tsx}",
      ".next-build/**",
      ".next/**",
      "scripts/navigation-guard-preview/.next/**",
      "scripts/navigation-guard-preview/next-env.d.ts",
      ".next-preview/**",
      ".next-loop/**",
      // The dedicated Playwright build directories (see playwright.config.ts).
      ".next-e2e/**",
      ".next-e2e-preview/**",
      ".next-storage-verify/**",
      "out/**",
      // Local captures, generated files, and source snapshots from audits.
      "output/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "convex/_generated/**",
    ],
  },
  ...next,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    plugins: { navigation },
    rules: { "navigation/architecture": "error" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: "Use SelectControl instead of a native <select> element.",
        },
      ],
    },
  },
  {
    files: ["convex/**/*.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": rawBuilders() },
  },
  {
    files: ["convex/lib/tenantFunctions.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": rawBuilders([
        "queryGeneric",
        "mutationGeneric",
        "actionGeneric",
      ]),
    },
  },
  {
    files: ["convex/lib/clerkWebhook.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": rawBuilders([
        "httpActionGeneric",
      ]),
    },
  },
  {
    files: ["convex/finishedGoods/attachments.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": rawBuilders(["mutation"]),
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", dropdowns] },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: { "@typescript-eslint/no-restricted-imports": frontendImports() },
  },
  {
    files: [
      "src/components/ui/SelectControl.tsx",
      "src/components/ui/select.tsx",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": frontendImports(
        undefined,
        false,
      ),
    },
  },
  {
    files: ["src/features/finishedGoods/jobScan/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", dropdowns] },
  },
  ...["JobScanScreen", "JobScanRecords"].map((entry, index) => ({
    // Literal brackets in the app directory are escaped in minimatch patterns.
    files: [
      `src/app/\\[locale\\]/(desktop)/finished-goods/scan/${index ? "records/" : ""}page.tsx`,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": frontendImports(entry),
    },
  })),
  prettier,
);
