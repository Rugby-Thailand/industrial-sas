"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { enUS } from "@clerk/localizations/en-US";
import { thTH } from "@clerk/localizations/th-TH";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";

import type { AppLocale } from "@/i18n/routing";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";

import { useAppEnvironment } from "./EnvironmentProvider";

const CLERK_LOCALIZATIONS = { th: thTH, en: enUS } as const;

/**
 * Clerk's account controls follow the page language. Clerk's Thai catalogue
 * leaves the account menu trigger unnamed (it falls back to English), so our
 * own messages name it in both languages.
 */
function useClerkLocalization() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("Navigation");
  const openMenu = t("openAccountMenu");
  const closeMenu = t("closeAccountMenu");
  return useMemo(() => {
    const catalogue = CLERK_LOCALIZATIONS[locale] ?? thTH;
    return {
      ...catalogue,
      userButton: {
        ...catalogue.userButton,
        action__openUserMenu: openMenu,
        action__closeUserMenu: closeMenu,
      },
    };
  }, [closeMenu, locale, openMenu]);
}

export function IdentityProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const environment = useAppEnvironment();
  const localization = useClerkLocalization();
  const publishableKey = resolveClerkPublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  if (!environment.identityConfigured || !publishableKey)
    return <>{children}</>;

  return (
    <ClerkProvider publishableKey={publishableKey} localization={localization}>
      {children}
    </ClerkProvider>
  );
}
