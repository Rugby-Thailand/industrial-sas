/**
 * Tailwind CSS v4 is configured through the PostCSS plugin plus the
 * `@import "tailwindcss"` directive in `src/app/globals.css`.
 * No `tailwind.config.*` file is required; content sources are auto-detected.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
