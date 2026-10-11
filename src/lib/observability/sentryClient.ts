import * as Sentry from "@sentry/nextjs";
import { normalizeRoute } from "./dimensions";
import {
  sentryDataCollection,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  privateSentryTransport,
} from "./sentryPolicy";

let initialized = false;
let navigation: ReturnType<typeof Sentry.startInactiveSpan> | undefined;
export function initSentryClient() {
  if (
    initialized ||
    process.env.NEXT_PUBLIC_SENTRY_ENABLED !== "1" ||
    !process.env.NEXT_PUBLIC_SENTRY_DSN
  )
    return;
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dataCollection: sentryDataCollection,
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration()],
    tracesSampler: ({ name }) => (name.startsWith("ui.route/") ? 0.05 : 0),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 0,
    tracePropagationTargets: [],
    beforeSend: sanitizeSentryEvent,
    beforeSendSpan: sanitizeSentrySpan,
    transport: (options: Parameters<typeof Sentry.makeFetchTransport>[0]) =>
      privateSentryTransport(Sentry.makeFetchTransport(options)),
  });
  initialized = true;
}
export function startRouteTrace(url: string) {
  initSentryClient();
  if (!initialized) return;
  navigation?.end();
  const route = normalizeRoute(new URL(url, window.location.origin).pathname);
  navigation = Sentry.startInactiveSpan({
    name: `ui.route/${route}`,
    op: "ui.route",
    forceTransaction: true,
  });
}
// Measures route-shell commit, not Convex data readiness or a field percentile.
export function finishRouteTrace() {
  navigation?.end();
  navigation = undefined;
}

export function recordSentryEvent(event: Sentry.Event) {
  initSentryClient();
  if (initialized) Sentry.captureEvent(event);
}
