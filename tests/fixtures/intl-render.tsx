/**
 * Rendering a component the way the application renders it.
 *
 * Every screen in this repository sits under a locale provider and an
 * environment provider, and a test that renders without them is testing a
 * component that does not exist. Wrapping here rather than in each test also
 * means the *Thai* catalogue is the default: `ADR-0010` §5 requires layouts to
 * be exercised with real Thai strings rather than Latin placeholders, because
 * Thai changes line height and wrapping.
 *
 * The environment is a parameter with no default, so a test states which
 * configuration it is exercising instead of inheriting whatever `process.env`
 * happens to hold in the runner.
 */
import { NextIntlClientProvider } from "next-intl";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { messagesFor } from "@/i18n/messages";
import { DEFAULT_TIME_ZONE, type AppLocale } from "@/i18n/routing";
import { resolveAppEnvironment, type AppEnvironment } from "@/lib/environment";

/** A fully configured deployment: backend and identity provider both present. */
export const configuredEnvironment: AppEnvironment = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});

/** Nothing configured — the state of a fresh clone. */
export const unconfiguredEnvironment: AppEnvironment = resolveAppEnvironment(
  {},
);

/** Local preview data, as `next dev` with the opt-in set produces it. */
export const previewEnvironment: AppEnvironment = resolveAppEnvironment({
  localPreviewFlag: "1",
  nodeEnv: "development",
});

export function renderWithIntl(
  ui: ReactElement,
  options: {
    readonly locale?: AppLocale;
    readonly environment?: AppEnvironment;
  } = {},
): RenderResult {
  const locale = options.locale ?? "th";
  const environment = options.environment ?? unconfiguredEnvironment;

  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messagesFor(locale)}
      timeZone={DEFAULT_TIME_ZONE}
    >
      <EnvironmentProvider environment={environment}>{ui}</EnvironmentProvider>
    </NextIntlClientProvider>,
  );
}
