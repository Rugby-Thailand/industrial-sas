import { redirect } from "next/navigation";

import { readAppAccess } from "@/lib/auth/appAccess";
import { ROUTES } from "@/lib/navigation";

/**
 * The locale root has no content of its own.
 *
 * A landing page would be a screen an operator has to get past to start work.
 * The dashboard is the first useful surface, so `/th` and `/en` go straight
 * there; the redirect is locale-aware, so `/en` lands on `/en/dashboard` rather
 * than bouncing through the default locale.
 */
export default async function LocaleRootPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const access = await readAppAccess();
  redirect(
    access === "APP"
      ? `/${locale}${ROUTES.dashboard}`
      : `/${locale}${ROUTES.signIn}`,
  );
}
