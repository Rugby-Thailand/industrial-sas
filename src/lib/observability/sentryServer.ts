import * as Sentry from "@sentry/nextjs";
import {
  sentryDataCollection,
  sanitizeSentryEvent,
  privateSentryTransport,
} from "./sentryPolicy";

export function initSentryServer() {
  if (process.env.SENTRY_ENABLED !== "1" || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    dataCollection: sentryDataCollection,
    defaultIntegrations: false,
    maxBreadcrumbs: 0,
    tracePropagationTargets: [],
    tracesSampleRate: 0,
    beforeSend: sanitizeSentryEvent,
    transport: (options: Parameters<typeof Sentry.makeNodeTransport>[0]) =>
      privateSentryTransport(Sentry.makeNodeTransport(options)),
  });
}
export const captureRequestError = Sentry.captureRequestError;
