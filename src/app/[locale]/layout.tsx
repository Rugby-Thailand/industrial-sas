import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/providers/AppProviders";
import { routing } from "@/i18n/routing";

import "../globals.css";

/**
 * The root layout, inside the locale segment.
 *
 * There is deliberately no `src/app/layout.tsx`. Every route in this
 * application is locale-prefixed (`localePrefix: "always"`), so this *is* the
 * root — and it has to be, because `<html lang>` must carry the resolved locale
 * from the very first byte. A root layout above this one could only hard-code a
 * language, and a Thai page announcing `lang="en"` is read out by a screen
 * reader in the wrong voice and hyphenated by the wrong rules.
 *
 * `setRequestLocale` is what lets these pages render statically: without it,
 * anything reading a translation opts the route into dynamic rendering.
 *
 * An unknown segment is a 404 rather than a silent fallback to Thai. `/xx/…` is
 * a URL nobody meant to visit, and quietly serving Thai for it would make every
 * typo look like a working page.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /*
   * No `maximumScale` and no `userScalable: false`. Pinch-zoom is how someone
   * reads a lot code in bad light, and disabling it fails WCAG 2.2 1.4.4.
   */
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "App" });

  return {
    title: t("name"),
    description: t("description"),
    applicationName: t("name"),
    manifest: "/manifest.webmanifest",
    /*
     * This application has no public surface and never should: it is a tenant's
     * warehouse data behind an identity provider. `noindex, nofollow` stays
     * until there is a marketing site that wants the opposite.
     */
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body className="bg-canvas text-text antialiased">
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
