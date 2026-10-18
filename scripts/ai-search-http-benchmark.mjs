import { performance } from "node:perf_hooks";
import { createServer } from "vite";

// In-process HTTP handling only: no Next.js host, network, Clerk, Convex or LLM.
// Run: node scripts/ai-search-http-benchmark.mjs
const server = await createServer({
  configFile: false,
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, watch: null },
  appType: "custom",
});

try {
  const { createAiApp } = await server.ssrLoadModule("/src/lib/ai/app.ts");
  const app = createAiApp({
    authenticate: async () => "synthetic-token",
    interpret: async () => ({
      ok: true,
      requestId: "benchmark",
      value: { ok: false, code: "AI_UNAVAILABLE" },
    }),
  });
  const body = JSON.stringify({
    query: "open holidays",
    context: { page: null, employee: false, date: false, period: false },
  });
  const request = () =>
    new Request("http://localhost/api/ai/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  for (let index = 0; index < 100; index += 1)
    await (await app.fetch(request())).text();
  const samples = [];
  for (let index = 0; index < 5_000; index += 1) {
    const input = request();
    const started = performance.now();
    const response = await app.fetch(input);
    await response.text();
    if (response.status !== 200) throw new Error("Benchmark request failed.");
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const percentile = (fraction) =>
    samples[Math.floor(samples.length * fraction)];
  console.log(
    JSON.stringify(
      {
        scope:
          "Warm in-process Elysia AI search with synthetic auth/action; excludes hosting, network and model latency",
        runtime: process.version,
        samples: samples.length,
        medianMs: Number(percentile(0.5).toFixed(4)),
        p95Ms: Number(percentile(0.95).toFixed(4)),
        meanMs: Number(
          (
            samples.reduce((sum, value) => sum + value, 0) / samples.length
          ).toFixed(4),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
