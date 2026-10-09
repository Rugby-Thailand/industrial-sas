import { SignIn } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import { PublicInfoNav } from "@/components/system/PublicInfoNav";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";
import { ROUTES } from "@/lib/navigation";
import { plannerReturnPath } from "@/lib/auth/returnPath";

export default async function SignInScreen({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { locale } = await params;
  const returnTo = plannerReturnPath((await searchParams).returnTo, locale);
  setRequestLocale(locale);
  const t = await getTranslations("SignIn");
  const identityConfigured =
    resolveClerkPublishableKey(
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    ) !== undefined;

  if (identityConfigured) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-8">
        <PageHeader title={t("title")} showBack={false} />
        <SignIn
          routing="path"
          path={`/${locale}/sign-in`}
          fallbackRedirectUrl={`/${locale}${ROUTES.storageLayouts}`}
          {...(returnTo ? { forceRedirectUrl: returnTo } : {})}
          appearance={{
            elements: {
              rootBox: { width: "100%" },
              cardBox: { width: "100%", boxShadow: "none" },
              card: {
                border: "1px solid var(--token-border)",
                borderRadius: "8px",
                boxShadow: "none",
              },
              headerTitle: "text-text",
              formFieldInput: {
                minHeight: "44px",
                fontSize: "16px",
                borderColor: "var(--token-border-strong)",
              },
              socialButtonsBlockButton: { minHeight: "44px" },
              formFieldInputShowPasswordButton: {
                minHeight: "44px",
                minWidth: "44px",
              },
              formButtonPrimary: {
                minHeight: "44px",
                backgroundColor: "var(--token-accent)",
                color: "var(--token-accent-contrast)",
              },
            },
          }}
        />
        <PublicInfoNav />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <PageHeader title={t("title")} showBack={false} />
      <Notice
        tone="accent"
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
      />
      <SetupChecklist />
      <Link
        href={ROUTES.storageLayouts}
        className="flex min-h-touch w-fit items-center rounded-md border border-border-strong px-4 font-medium text-text"
      >
        {t("backHome")}
      </Link>
      <PublicInfoNav />
    </main>
  );
}
