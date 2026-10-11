import { speedInsightsPayload } from "@/lib/observability/speedInsights";

export async function POST(request: Request): Promise<Response> {
  if (process.env.NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED !== "1")
    return new Response(null, { status: 204 });
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    return new Response(null, { status: 403 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const payload = speedInsightsPayload(JSON.parse(text), origin);
    if (!payload) return new Response(null, { status: 400 });
    const app = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
    if (app.protocol !== "https:") return new Response(null, { status: 503 });
    const result = await fetch(new URL("/_vercel/speed-insights/vitals", app), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    return new Response(null, { status: result.ok ? 204 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
