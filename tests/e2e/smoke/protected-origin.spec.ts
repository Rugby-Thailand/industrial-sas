import { createServer, type RequestListener, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import {
  installProtectedOrigin,
  OIDC_HEADER,
  protectedRequest,
} from "../support/protected-origin";

// Regression uses only two ephemeral loopback origins and a deliberately
// nonfunctional token. It proves real browser/API redirect behavior without
// contacting staging, Clerk, Convex or any other provider.
async function origins() {
  const received: {
    origin: string;
    path: string;
    token: string | undefined;
  }[] = [];
  const servers: Server[] = [];
  const start = async (handler: RequestListener) => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Loopback listener unavailable");
    return `http://127.0.0.1:${address.port}`;
  };
  const other = await start((request, response) => {
    received.push({
      origin: "other",
      path: request.url ?? "",
      token: request.headers[OIDC_HEADER] as string | undefined,
    });
    response.end("<html><body>synthetic other origin</body></html>");
  });
  const protectedOrigin = await start((request, response) => {
    received.push({
      origin: "protected",
      path: request.url ?? "",
      token: request.headers[OIDC_HEADER] as string | undefined,
    });
    if (request.url === "/cross")
      response.writeHead(302, { location: `${other}/final` });
    else if (request.url === "/same")
      response.writeHead(302, { location: "/final" });
    response.end("<html><body>synthetic protected origin</body></html>");
  });
  const close = async () => {
    for (const server of servers) server.closeAllConnections();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  };
  return { received, other, protectedOrigin, close };
}

test.describe("protection routing", () => {
  test("browser keeps refreshed OIDC on the protected origin across redirects", async ({
    context,
    page,
  }) => {
    const local = await origins();
    let token = "first-nonfunctional-local-token";
    let reads = 0;
    let protection:
      Awaited<ReturnType<typeof installProtectedOrigin>> | undefined;
    try {
      // Even a stale caller override must be replaced/stripped for every hop.
      await context.setExtraHTTPHeaders({
        [OIDC_HEADER]: "stale-nonfunctional-global-token",
      });
      protection = await installProtectedOrigin(context, {
        origin: local.protectedOrigin,
        readToken: () => `${token}-${++reads}`,
      });
      await page.goto(`${local.protectedOrigin}/same`);
      expect(page.url()).toBe(`${local.protectedOrigin}/final`);
      expect(
        local.received
          .filter(({ origin }) => origin === "protected")
          .map(({ token }) => token),
      ).toEqual([`${token}-1`, `${token}-2`]);
      local.received.length = 0;
      token = "rotated-nonfunctional-local-token";
      await page.goto(`${local.protectedOrigin}/cross`);
      expect(page.url()).toBe(`${local.other}/final`);
      expect(local.received).toEqual([
        { origin: "protected", path: "/cross", token: `${token}-3` },
        { origin: "other", path: "/final", token: undefined },
      ]);
      local.received.length = 0;
      await page.goto(`${local.other}/direct`);
      expect(local.received).toEqual([
        { origin: "other", path: "/direct", token: undefined },
      ]);
      protection.assertHealthy();
    } finally {
      await context.setExtraHTTPHeaders({});
      await protection?.dispose();
      await local.close();
    }
  });

  test("browser blocks unavailable protection and cleans up its session", async ({
    context,
    page,
  }) => {
    const local = await origins();
    const protection = await installProtectedOrigin(context, {
      origin: local.protectedOrigin,
      readToken: () => {
        throw new Error("synthetic unavailable token");
      },
    });
    try {
      await expect(
        page.goto(`${local.protectedOrigin}/direct`),
      ).rejects.toThrow();
      expect(local.received).toEqual([]);
      expect(() => protection.assertHealthy()).toThrow(
        "SMOKE_PROTECTION_REQUEST_FAILED",
      );
    } finally {
      await protection.dispose();
      const next = await context.newPage();
      await next.goto(`${local.other}/after-cleanup`);
      expect(local.received).toEqual([
        { origin: "other", path: "/after-cleanup", token: undefined },
      ]);
      await next.close();
      await local.close();
    }
  });

  test("credentialed contexts fail closed on unexpected pages", async ({
    context,
    page,
  }) => {
    // The page fixture exists before interception starts; no provider traffic.
    expect(page.url()).toBe("about:blank");
    const protection = await installProtectedOrigin(context, undefined);
    try {
      await context.newPage().catch(() => undefined);
      expect(() => protection.assertHealthy()).toThrow(
        "SMOKE_PROTECTION_REQUEST_FAILED",
      );
    } finally {
      await protection.dispose();
    }
  });

  test("API request context strips OIDC on a real cross-origin redirect", async ({
    request,
  }) => {
    const local = await origins();
    try {
      const response = await protectedRequest(
        request,
        `${local.protectedOrigin}/cross`,
        {
          origin: local.protectedOrigin,
          readToken: () => "nonfunctional-local-token",
        },
      );
      expect(response.status()).toBe(200);
      expect(local.received).toEqual([
        {
          origin: "protected",
          path: "/cross",
          token: "nonfunctional-local-token",
        },
        { origin: "other", path: "/final", token: undefined },
      ]);
    } finally {
      await local.close();
    }
  });
});
