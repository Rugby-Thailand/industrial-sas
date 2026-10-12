import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { request, type APIRequestContext } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  verifyBunRuntime,
  waitForReleasedResponse,
} from "../e2e/support/release-readiness";

const SHA = "a".repeat(40);
const PREVIOUS = "b".repeat(40);
const SENTINEL = "nonfunctional-sensitive-sentinel";
const runtime = { runtime: "bun", version: "1.4.3", releaseSha: null };

interface Probe {
  sha?: string;
  status?: number;
  cacheControl?: string;
  body?: unknown;
  rawBody?: string;
  hang?: boolean;
  disconnect?: boolean;
}

async function withProbe(
  responses: Probe[],
  work: (context: APIRequestContext, paths: string[]) => Promise<void>,
) {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const next = responses[Math.min(paths.length, responses.length - 1)]!;
    paths.push(`${req.method} ${req.url}`);
    if (next.hang) return;
    if (next.disconnect) {
      req.socket.destroy();
      return;
    }
    res.writeHead(next.status ?? 200, {
      ...(next.sha === undefined ? {} : { "x-release-sha": next.sha }),
      "content-type": "application/json",
      "cache-control": next.cacheControl ?? "no-store",
      ...((next.status ?? 200) === 302 ? { location: "/redirected" } : {}),
    });
    res.end(next.rawBody ?? JSON.stringify(next.body ?? runtime));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const context = await request.newContext({
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  try {
    await work(context, paths);
  } finally {
    await context.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const fast = { timeoutMs: 1_000, intervalMs: 5 };

describe("release HTTP readiness", () => {
  it.each(["/th/sign-in", "/api/runtime"] as const)(
    "waits for the promoted commit on %s without rebuilding or retrying a test",
    async (path) => {
      await withProbe(
        [{ sha: PREVIOUS }, { sha: SHA }],
        async (context, paths) => {
          const response = await waitForReleasedResponse(
            context,
            path,
            SHA,
            fast,
          );
          expect(response.headers()["x-release-sha"]).toBe(SHA);
          expect(await response.json()).toEqual(runtime);
          expect(paths).toEqual([`GET ${path}`, `GET ${path}`]);
          await response.dispose();
        },
      );
    },
  );

  it("fails at the deadline when the domain remains on the wrong commit", async () => {
    await withProbe([{ sha: PREVIOUS }], async (context, paths) => {
      const start = performance.now();
      await expect(
        waitForReleasedResponse(context, "/api/runtime", SHA, {
          timeoutMs: 100,
          intervalMs: 5,
        }),
      ).rejects.toThrow("SMOKE_RELEASE_SHA_MISMATCH");
      expect(paths.length).toBeGreaterThan(1);
      expect(performance.now() - start).toBeLessThan(2_000);
    });
  });

  it.each([302, 401, 403, 500, 503])(
    "fails immediately on HTTP %s, without following redirects or retrying errors",
    async (status) => {
      await withProbe([{ status, sha: SHA }], async (context, paths) => {
        await expect(
          waitForReleasedResponse(context, "/api/runtime", SHA, fast),
        ).rejects.toThrow("SMOKE_RELEASE_HTTP_STATUS_INVALID");
        expect(paths).toEqual(["GET /api/runtime"]);
      });
    },
  );

  it.each([undefined, SENTINEL])(
    "refuses a missing or invalid commit marker without retaining its value",
    async (sha) => {
      await withProbe(
        sha === undefined ? [{}] : [{ sha }],
        async (context, paths) => {
          await expect(
            waitForReleasedResponse(context, "/api/runtime", SHA, fast),
          ).rejects.toThrow("SMOKE_RELEASE_SHA_MISSING_OR_INVALID");
          expect(paths).toEqual(["GET /api/runtime"]);
        },
      );
    },
  );

  it("bounds an unresponsive request and does not retry a transport failure", async () => {
    for (const probe of [{ hang: true }, { disconnect: true }]) {
      await withProbe([probe], async (context, paths) => {
        const start = performance.now();
        await expect(
          waitForReleasedResponse(context, "/api/runtime", SHA, {
            timeoutMs: 100,
            intervalMs: 5,
          }),
        ).rejects.toThrow("SMOKE_RELEASE_REQUEST_FAILED");
        expect(paths).toEqual(["GET /api/runtime"]);
        expect(performance.now() - start).toBeLessThan(2_000);
      });
    }
  });

  it("fails a transport error during propagation instead of retrying it", async () => {
    await withProbe(
      [{ sha: PREVIOUS }, { disconnect: true }],
      async (context, paths) => {
        await expect(
          waitForReleasedResponse(context, "/api/runtime", SHA, fast),
        ).rejects.toThrow("SMOKE_RELEASE_REQUEST_FAILED");
        expect(paths).toEqual(["GET /api/runtime", "GET /api/runtime"]);
      },
    );
  });

  it.each([null, SHA])(
    "accepts Bun with the supported body SHA %s",
    async (releaseSha) => {
      await withProbe(
        [{ sha: SHA, body: { ...runtime, releaseSha } }],
        async (context, paths) => {
          const response = await waitForReleasedResponse(
            context,
            "/api/runtime",
            SHA,
            fast,
          );
          await verifyBunRuntime(response, SHA);
          expect(paths).toEqual(["GET /api/runtime"]);
        },
      );
    },
  );

  it.each([
    [{ cacheControl: "public" }, "SMOKE_RUNTIME_CACHE_INVALID"],
    [{ rawBody: SENTINEL }, "SMOKE_RUNTIME_RESPONSE_INVALID"],
    [{ body: SENTINEL }, "SMOKE_RUNTIME_RESPONSE_INVALID"],
    [{ body: { ...runtime, runtime: "node" } }, "SMOKE_RUNTIME_NOT_BUN"],
    [
      { body: { ...runtime, version: "2.0.0" } },
      "SMOKE_RUNTIME_VERSION_INVALID",
    ],
    [{ body: { ...runtime, version: null } }, "SMOKE_RUNTIME_VERSION_INVALID"],
    [
      { body: { ...runtime, releaseSha: PREVIOUS } },
      "SMOKE_RUNTIME_SHA_INVALID",
    ],
    [
      { body: { runtime: "bun", version: "1.4.3" } },
      "SMOKE_RUNTIME_SHA_INVALID",
    ],
  ] satisfies [Probe, string][])(
    "rejects an invalid runtime contract once the expected commit serves",
    async (probe, code) => {
      await withProbe([{ ...probe, sha: SHA }], async (context, paths) => {
        const response = await waitForReleasedResponse(
          context,
          "/api/runtime",
          SHA,
          fast,
        );
        await expect(verifyBunRuntime(response, SHA)).rejects.toThrow(code);
        expect(paths).toEqual(["GET /api/runtime"]);
      });
    },
  );
});
