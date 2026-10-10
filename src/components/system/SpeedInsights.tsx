"use client";
import { SpeedInsights as VercelSpeedInsights } from "@vercel/speed-insights/react";
import { usePathname } from "next/navigation";
import {
  beforeSpeedInsightsSend,
  telemetryPath,
} from "@/lib/observability/speedInsights";

export function SpeedInsights() {
  const pathname = usePathname();
  return process.env.NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED === "1" ? (
    <VercelSpeedInsights
      route={telemetryPath(pathname ?? "/")}
      beforeSend={beforeSpeedInsightsSend}
      endpoint="/api/observability/speed-insights"
      scriptSrc="/_vercel/speed-insights/script.js"
      debug={false}
    />
  ) : null;
}
