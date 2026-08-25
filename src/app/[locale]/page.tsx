import { redirect } from "next/navigation";

import { readAppAccess } from "@/lib/auth/appAccess";
import { ROUTES } from "@/lib/navigation";

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
