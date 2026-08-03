import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Industrial SSA — scaffold",
  description:
    "Workspace scaffold for the Industrial SSA warehouse management system. No domain functionality is implemented yet.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout for the scaffold.
 *
 * The locale-segmented `[locale]` routing tree, PWA shells, and the separate
 * handheld/desktop shells described in the project plan are not built yet, so
 * `lang` is hard-coded to the Thai-first default.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th">
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
