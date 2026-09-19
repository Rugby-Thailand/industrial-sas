import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { notFound, redirect } from "next/navigation";

import { readAppAccess } from "@/lib/auth/appAccess";
import { ROUTES } from "@/lib/navigation";

export default async function LocaleRootPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const access = await readAppAccess();
  redirect(
    access === "APP"
      ? `/${locale}${ROUTES.storageLayouts}`
      : `/${locale}${ROUTES.signIn}`,
  );
}
