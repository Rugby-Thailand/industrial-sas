if (
  process.env.NEXT_PUBLIC_SENTRY_ENABLED === "1" &&
  process.env.NEXT_PUBLIC_SENTRY_DSN
) {
  void import("./lib/observability/sentryClient")
    .then((module) => module.initSentryClient())
    .catch(() => {});
}
export function onRouterTransitionStart(url: string) {
  if (
    process.env.NEXT_PUBLIC_SENTRY_ENABLED === "1" &&
    process.env.NEXT_PUBLIC_SENTRY_DSN
  ) {
    startRouteTrace(url);
  }
}
import { startRouteTrace } from "./lib/observability/sentryTraceBridge";
