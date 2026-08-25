import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/providers/AppProviders";
import { WebVitals } from "@/components/system/WebVitals";
import { pickMessages, SHELL_NAMESPACES } from "@/i18n/clientMessages";
import { routing } from "@/i18n/routing";

import "../globals.css";

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
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="bg-canvas text-text antialiased">
        <NextIntlClientProvider
          messages={pickMessages(messages, SHELL_NAMESPACES)}
        >
          <AppProviders>
            <WebVitals />
            {children}
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
