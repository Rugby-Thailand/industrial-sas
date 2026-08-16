import { SignIn } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";
import { ROUTES } from "@/lib/navigation";

/**
 * Clerk's sign-in screen, shared by its entry route and nested path steps.
 *
 * The repository owns no credentials. Clerk owns credentials, MFA, sessions,
 * SSO callbacks, and organization switching (`ADR-0001` §2, C-03).
 */
export default async function SignInScreen({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SignIn");
  const identityConfigured =
    resolveClerkPublishableKey(
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    ) !== undefined;

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
