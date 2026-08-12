import type { ReactNode } from "react";

import { RouteMessages } from "@/i18n/RouteMessages";

/**
 * The client message scope for the sign-in route.
 *
 * This layout adds no markup. It exists so the namespaces below it are shipped
 * to this subtree and to no other — `@/i18n/clientMessages` holds the set and
 * the reasoning, and `clientMessages.test.ts` proves it still matches what the
 * client components here actually ask for.
 */
export default async function SignInLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteMessages scope="(auth)/sign-in" locale={locale}>
      {children}
    </RouteMessages>
  );
}
