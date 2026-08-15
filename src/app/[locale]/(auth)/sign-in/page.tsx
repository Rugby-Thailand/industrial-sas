import { SignIn } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

/**
 * The sign-in route, and what it is instead of a sign-in form.
 *
 * Clerk owns credentials, MFA, sessions, and organization switching
 * (`ADR-0001` §2, C-03). This repository must not grow a second credential
 * surface, so there is no form here and there never will be — when
 * `@clerk/nextjs` is configured this route mounts Clerk's own component.
 *
 * Until then the honest content is *why* it is unavailable and which
 * configuration is missing, so someone hitting a "sign in required" panel from an
 * inventory screen lands somewhere that explains itself rather than on a dead
 * page.
 *
 * No shell chrome: the auth group has no navigation, because a workspace context
 * bar naming an organization would be meaningless with no session to name one
 * for.
 */
export default async function SignInPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SignIn");
  const identityConfigured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
  );

  if (identityConfigured) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 p-6">
        <PageHeader title={t("title")} />
        <SignIn
          routing="path"
          path={`/${locale}/sign-in`}
          fallbackRedirectUrl={`/${locale}${ROUTES.dashboard}`}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <PageHeader title={t("title")} />
      <Notice
        tone="accent"
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
      />
      <SetupChecklist />
      <Link
        href={ROUTES.dashboard}
        className="flex min-h-touch w-fit items-center rounded-md border border-border-strong px-4 font-medium text-text"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}
