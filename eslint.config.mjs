import next from "eslint-config-next";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

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
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "convex/_generated/**",
    ],
  },
  ...next,
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
  prettier,
);
