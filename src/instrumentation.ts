import type { Instrumentation } from "next";
export async function register() {
  if (
    process.env.SENTRY_ENABLED === "1" &&
    process.env.SENTRY_DSN &&
    process.env.NEXT_RUNTIME === "nodejs"
  ) {
    const sentry = await import("./lib/observability/sentryServer");
    sentry.initSentryServer();
  }
}
export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  if (process.env.SENTRY_ENABLED === "1" && process.env.SENTRY_DSN) {
    try {
      const sentry = await import("./lib/observability/sentryServer");
      await sentry.captureRequestError(...args);
    } catch {
      // Reporting must not change the application's error response.
    }
  }
};
