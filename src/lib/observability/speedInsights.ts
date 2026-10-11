import type { BeforeSendMiddleware } from "@vercel/speed-insights";
import { normalizeRoute } from "./dimensions";

export function telemetryPath(path: string): string {
  return `/${normalizeRoute(path)?.replaceAll(".", "/") ?? "root"}`;
}

export const beforeSpeedInsightsSend: BeforeSendMiddleware = (event) => {
  try {
    const url = new URL(event.url);
    return {
      type: "vital",
      url: `${url.origin}${telemetryPath(url.pathname)}`,
      route: telemetryPath(url.pathname),
    };
  } catch {
    return null;
  }
};

// The hosted script also collects DOM selectors. Its beforeSend API only
// exposes URL/route, so a same-origin relay applies the dimension allowlist
// before anything leaves this application for Vercel's collector.
export function speedInsightsPayload(input: unknown, origin: string) {
  if (
    !input ||
    typeof input !== "object" ||
    !("metrics" in input) ||
    !Array.isArray(input.metrics) ||
    input.metrics.length > 6
  )
    return null;
  const metrics = input.metrics.flatMap((metric: unknown) => {
    if (!metric || typeof metric !== "object") return [];
    const m = metric as Record<string, unknown>;
    if (
      !["TTFB", "FCP", "LCP", "FID", "CLS", "INP"].includes(String(m.type)) ||
      typeof m.value !== "number" ||
      !Number.isFinite(m.value) ||
      m.value < 0 ||
      typeof m.href !== "string"
    )
      return [];
    try {
      const url = new URL(m.href);
      if (url.origin !== origin) return [];
      const route = telemetryPath(url.pathname);
      return [
        {
          id: crypto.randomUUID(),
          type: m.type,
          value: m.value,
          route,
          href: `${origin}${route}`,
        },
      ];
    } catch {
      return [];
    }
  });
  return metrics.length
    ? {
        // Required by the collector. Unknown preserves the wire contract
        // without forwarding client network information as a new dimension.
        speed: "",
        metrics,
        scriptVersion: "0.1.3",
        sdkName: "@vercel/speed-insights",
        sdkVersion: "2.0.0",
      }
    : null;
}
