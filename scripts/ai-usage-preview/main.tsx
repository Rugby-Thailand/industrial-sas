/// <reference types="vite/client" />
/**
 * AI usage visual fixture: the production DesktopShell, AiUsageScreen and
 * providers, rendered with in-memory sample data so the layout can be
 * captured in a browser without signing in, a Convex backend, upstream
 * requests or any write. See README.md for the URL parameters.
 */
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { createRoot, type Root } from "react-dom/client";

import { AiUsageAccessProvider } from "@/components/providers/AiUsageAccessProvider";
import { HrAccessProvider } from "@/components/providers/HrAccessProvider";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { DesktopShell } from "@/components/shell/DesktopShell";
import { PageContainer } from "@/components/ui/PageContainer";
import { AiUsageScreen } from "@/features/aiUsage/AiUsageScreen";
import { messagesFor } from "@/i18n/messages";
import {
  ESTIMATE_STALE_AFTER_MS,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";
import { resolveAppEnvironment } from "@/lib/environment";
import {
  readStoredWarehouse,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";
import { FIXTURE } from "./stubs/fixtureData";
import "../../src/app/globals.css";

const params = new URLSearchParams(window.location.search);
const locale = params.get("locale") === "th" ? "th" : "en";
const theme = params.get("theme") === "light" ? "light" : "dark";
if (params.has("theme")) localStorage.setItem("ai-usage-fixture-theme", theme);
document.documentElement.lang = locale;
document.title = `AI usage — visual fixture (sample data, ${locale})`;
if (!readStoredWarehouse()) writeStoredWarehouse("wh-fixture-1");

// Values read from the documented sources on 2026-10-11 (USD/THB 33.583;
// card funding 5.5%, US$0.80 minimum), frozen here as fixture inputs.
const loadedAt = Date.now();
const fetchedAt =
  FIXTURE.estimate === "stale"
    ? loadedAt - ESTIMATE_STALE_AFTER_MS - 3_600_000
    : loadedAt - 2 * 3_600_000;
const estimate: UsageEstimate =
  FIXTURE.estimate === "unavailable"
    ? {
        version: 1,
        loadedAt,
        fx: { status: "UNAVAILABLE" },
        funding: { status: "UNAVAILABLE" },
      }
    : {
        version: 1,
        loadedAt,
        fx: {
          status: FIXTURE.estimate === "stale" ? "STALE" : "READY",
          value: { rate: 33.583, date: "2026-10-11", fetchedAt },
        },
        funding: {
          status: FIXTURE.estimate === "stale" ? "STALE" : "READY",
          value: { percent: 5.5, minimumUsd: 0.8, fetchedAt },
        },
      };
const estimatePromise =
  FIXTURE.estimate === "loading"
    ? new Promise<UsageEstimate>(() => {})
    : Promise.resolve(estimate);

// Backend and identity "configured" so the real authenticated providers
// mount; their Convex hooks are answered by the fixture stub.
const environment = resolveAppEnvironment({
  convexUrl: "https://fixture.invalid",
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});

function FixtureLabel() {
  if (params.get("label") === "0") return null;
  return (
    <p
      aria-hidden="true"
      className="pointer-events-none fixed right-2 bottom-2 z-50 rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[0.6875rem] text-muted"
    >
      Visual fixture · sample data
    </p>
  );
}

// Reuse the development root when Vite reloads this entry during layout work.
const root: Root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <ThemeProvider
    attribute="class"
    defaultTheme={theme}
    storageKey="ai-usage-fixture-theme"
    disableTransitionOnChange
  >
    <NextIntlClientProvider
      locale={locale}
      messages={messagesFor(locale)}
      timeZone="Asia/Bangkok"
    >
      <EnvironmentProvider environment={environment}>
        {/* The same order as AppProviders' authenticated branch. */}
        <WorkspaceProvider>
          <HrAccessProvider>
            <AiUsageAccessProvider>
              <DesktopShell>
                <PageContainer size="full">
                  <AiUsageScreen estimate={estimatePromise} />
                </PageContainer>
              </DesktopShell>
            </AiUsageAccessProvider>
          </HrAccessProvider>
        </WorkspaceProvider>
      </EnvironmentProvider>
    </NextIntlClientProvider>
    <FixtureLabel />
  </ThemeProvider>,
);
