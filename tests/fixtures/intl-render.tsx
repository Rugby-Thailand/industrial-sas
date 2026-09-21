import { NextIntlClientProvider } from "next-intl";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { messagesFor } from "@/i18n/messages";
import { DEFAULT_TIME_ZONE, type AppLocale } from "@/i18n/routing";
import { resolveAppEnvironment, type AppEnvironment } from "@/lib/environment";

export const configuredEnvironment: AppEnvironment = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});

export const unconfiguredEnvironment: AppEnvironment = resolveAppEnvironment(
  {},
);

export const testEnvironment: AppEnvironment = configuredEnvironment;

export function renderWithIntl(
  ui: ReactElement,
  options: {
    readonly locale?: AppLocale;
    readonly environment?: AppEnvironment;
    readonly workspace?: boolean;
    /** Keep providers mounted when rerender receives an unwrapped component. */
    readonly preserveProviders?: boolean;
  } = {},
): RenderResult {
  const locale = options.locale ?? "th";
  const environment = options.environment ?? unconfiguredEnvironment;
  function Providers({ children }: { readonly children: ReactNode }) {
    const content =
      environment === configuredEnvironment && options.workspace !== false ? (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      ) : (
        children
      );
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={messagesFor(locale)}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <EnvironmentProvider environment={environment}>
          {content}
        </EnvironmentProvider>
      </NextIntlClientProvider>
    );
  }

  // Existing tests supply their own provider tree to rerender. Preserve that
  // contract while migrated tests opt into RTL's persistent wrapper.
  return options.preserveProviders
    ? render(ui, { wrapper: Providers })
    : render(Providers({ children: ui }));
}
