import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAiApp,
  type AiDependencies,
  type SearchOutcome,
} from "../../src/lib/ai/app";
import { interpretAiSearch } from "../../src/lib/ai/client";
import {
  groundIntent,
  NO_CONTEXT,
  parseModelIntent,
} from "../../convex/model/search/intent";

const REQUEST = { query: "open holidays", context: NO_CONTEXT };
const REQUEST_ID = "0199c9d0-0000-7000-8000-000000000001";
const BROWSER_TOKENS = {
  session: "browser-session-token",
  convex: "browser-convex-token",
};

function success(): SearchOutcome {
  const parsed = parseModelIntent({
    kind: "HR_SETTINGS_SECTION",
    page: null,
    settingsSection: "holidays",
    employeeFocus: null,
    employeeCode: null,
    employeeName: null,
    dateText: null,
    useContextEmployee: false,
    useContextDate: false,
    useContextPeriod: false,
    clarify: null,
    unsupportedTopic: null,
  });
  if (!parsed.ok) throw new Error("Invalid fixture.");
  return {
    ok: true,
    requestId: REQUEST_ID,
    value: {
      ok: true,
      today: "2026-10-11",
      intent: groundIntent(parsed.value, {
        query: REQUEST.query,
        today: "2026-10-11",
        context: NO_CONTEXT,
      }),
    },
  };
}

function fixture() {
  const authenticate = vi
    .fn<AiDependencies["authenticate"]>()
    .mockResolvedValue("synthetic-user-token");
  const interpret = vi
    .fn<AiDependencies["interpret"]>()
    .mockResolvedValue(success());
  const app = createAiApp({ authenticate, interpret });
  const post = (body: unknown = REQUEST) =>
    app.fetch(
      new Request("https://app.example/api/ai/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { app, post, authenticate, interpret };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Elysia AI search interface", () => {
  it("forwards validated input and the current actor's token, returning a grounded answer", async () => {
    const { post, interpret } = fixture();
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(success());
    expect(interpret).toHaveBeenCalledExactlyOnceWith(
      REQUEST,
      "synthetic-user-token",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=\d+\.\d+, convex;dur=\d+\.\d+$/,
    );
  });

  it("refuses an unauthenticated request without invoking the paid action", async () => {
    const { post, authenticate, interpret } = fixture();
    authenticate.mockResolvedValue(null);
    const response = await post();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "DENIED" });
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=\d+\.\d+$/,
    );
    expect(interpret).not.toHaveBeenCalled();
  });

  it.each([
    { ...REQUEST, query: "x".repeat(301) },
    { ...REQUEST, query: "" },
    {
      ...REQUEST,
      context: { ...NO_CONTEXT, page: "https://untrusted.example" },
    },
    { ...REQUEST, context: { ...NO_CONTEXT, employee: "yes" } },
  ])("rejects invalid input before calling the action", async (body) => {
    const { post, interpret } = fixture();
    const response = await post(body);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "QUERY_INVALID" });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("preserves Convex authorization denials", async () => {
    const { post, interpret } = fixture();
    const denied: SearchOutcome = {
      ok: false,
      requestId: REQUEST_ID,
      denial: {
        kind: "AUTHORIZATION_DENIED",
        code: "AUTHORIZATION_DENIED",
        requestId: REQUEST_ID,
        message: "Request denied.",
      },
    };
    interpret.mockResolvedValue(denied);
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(denied);
  });

  it.each([
    { ok: false, code: "AI_UNAVAILABLE" },
    { ok: false, code: "AI_TIMEOUT" },
    { ok: false, code: "AI_UNREADABLE" },
    { ok: false, code: "RATE_LIMITED", retryAfterMs: 125_000 },
  ] as const)(
    "preserves provider failures and the durable quota result",
    async (value) => {
      const { post, interpret } = fixture();
      interpret.mockResolvedValue({ ok: true, requestId: REQUEST_ID, value });
      const response = await post();
      expect(response.status).toBe(200);
      expect((await response.json()).value).toEqual(value);
    },
  );

  it("does not return provider exceptions or submitted text in error responses", async () => {
    const { app, post, interpret } = fixture();
    interpret.mockRejectedValue(new Error("SENTINEL provider body and token"));
    const failed = await post();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ code: "FAILED" });
    const malformed = await app.fetch(
      new Request("https://app.example/api/ai/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"query":"SENTINEL',
      }),
    );
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toEqual({ code: "QUERY_INVALID" });
  });

  it("refuses a response that violates the navigation contract without echoing it", async () => {
    const { post, interpret } = fixture();
    const invalid = success();
    if (!invalid.ok || !invalid.value.ok) throw new Error("Invalid fixture.");
    Object.assign(invalid.value.intent, { page: "SENTINEL-untrusted-route" });
    interpret.mockResolvedValue(invalid);
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "FAILED" });
  });

  it("uses the real Eden client against the HTTP interface, including error mapping", async () => {
    const { app, authenticate } = fixture();
    const requests: Request[] = [];
    vi.stubGlobal("window", { location: { origin: "https://app.example" } });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return app.fetch(request);
    });
    expect(await interpretAiSearch(REQUEST, BROWSER_TOKENS)).toEqual(success());
    expect(requests[0]?.headers.get("x-convex-token")).toBe(
      "browser-convex-token",
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer browser-session-token",
    );
    expect(requests[0]?.credentials).toBe("same-origin");
    expect(authenticate).toHaveBeenCalledWith(requests[0]);
    authenticate.mockResolvedValue(null);
    expect(await interpretAiSearch(REQUEST, BROWSER_TOKENS)).toEqual({
      ok: false,
    });
    expect(
      await interpretAiSearch({ ...REQUEST, query: "" }, BROWSER_TOKENS),
    ).toEqual({
      ok: true,
      value: { ok: false, code: "QUERY_INVALID" },
    });
  });
});

const server = vi.hoisted(() => ({ auth: vi.fn(), fetchAction: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: server.auth }));
vi.mock("convex/nextjs", () => ({ fetchAction: server.fetchAction }));

const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwtKey = signingKey.publicKey.export({ type: "spki", format: "pem" });
const issuer = "https://clerk.example";

function signedToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = [
    encode({ alg: "RS256", typ: "JWT", kid: "ai-auth-integration-test" }),
    encode({
      aud: "convex",
      azp: "https://app.example",
      sub: "user-a",
      org_id: "org-a",
      iss: issuer,
      iat: now,
      nbf: now - 10,
      exp: now + 60,
      ...overrides,
    }),
  ].join(".");
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), signingKey.privateKey).toString("base64url")}`;
}

async function postWithToken(token: string, origin = "https://app.example") {
  const { POST } = await import("../../src/app/api/ai/[[...slugs]]/route");
  return POST(
    new Request("https://app.example/api/ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-convex-token": token,
        origin,
      },
      body: JSON.stringify(REQUEST),
    }),
  );
}

describe("Next.js AI route authentication adapter", () => {
  beforeEach(() => {
    server.auth.mockReset();
    server.fetchAction.mockReset();
    vi.stubEnv("CLERK_JWT_KEY", jwtKey.toString());
  });

  it("obtains a Convex token from the active Clerk organization", async () => {
    const getToken = vi.fn().mockResolvedValue("current-convex-token");
    server.auth.mockResolvedValue({
      userId: "user-a",
      orgId: "org-a",
      getToken,
    });
    server.fetchAction.mockResolvedValue(success());
    const { POST } = await import("../../src/app/api/ai/[[...slugs]]/route");
    const response = await POST(
      new Request("https://app.example/api/ai/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(REQUEST),
      }),
    );
    expect(response.status).toBe(200);
    expect(getToken).toHaveBeenCalledExactlyOnceWith({ template: "convex" });
    expect(server.fetchAction).toHaveBeenCalledWith(
      expect.anything(),
      REQUEST,
      { token: "current-convex-token" },
    );
  });

  it.each([
    { userId: null, orgId: null },
    { userId: "user-a", orgId: null },
  ])("refuses missing identity or active organization", async (session) => {
    const getToken = vi.fn();
    server.auth.mockResolvedValue({ ...session, getToken });
    const { POST } = await import("../../src/app/api/ai/[[...slugs]]/route");
    const response = await POST(
      new Request("https://app.example/api/ai/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(REQUEST),
      }),
    );
    expect(response.status).toBe(401);
    expect(getToken).not.toHaveBeenCalled();
    expect(server.fetchAction).not.toHaveBeenCalled();
  });

  it.each([
    { org_id: "org-a" },
    { org_id: undefined, o: { id: "org-a" } },
    { org_id: "org-b", o: { id: "org-a" } },
    { aud: ["another-audience", "convex"] },
  ])(
    "reuses a signed token bound to the active user and organization",
    async (claims) => {
      const getToken = vi.fn();
      server.auth.mockResolvedValue({
        userId: "user-a",
        orgId: "org-a",
        sessionClaims: { iss: issuer },
        getToken,
      });
      server.fetchAction.mockResolvedValue(success());
      const token = signedToken(claims);
      const response = await postWithToken(token);
      expect(response.status).toBe(200);
      expect(getToken).not.toHaveBeenCalled();
      expect(server.fetchAction).toHaveBeenCalledWith(
        expect.anything(),
        REQUEST,
        {
          token,
        },
      );
    },
  );

  it.each([
    { sub: "user-b" },
    { sub: undefined },
    { org_id: "org-b" },
    { org_id: undefined },
    { org_id: "org-a", o: { id: "org-b" } },
    { org_id: "org-a", o: {} },
    { org_id: "org-a", o: ["org-a"] },
    { org_id: "org-a", o: "org-a" },
    { aud: "another-audience" },
    { aud: undefined },
    { aud: [] },
    { aud: ["convex", 42] },
    { iss: "https://another-clerk.example" },
    { iss: undefined },
    { azp: "https://untrusted.example" },
    { azp: undefined },
    { exp: Math.floor(Date.now() / 1000) - 3600 },
    { nbf: Math.floor(Date.now() / 1000) + 3600 },
  ])(
    "refuses mismatched or invalid signed claims without calling Convex",
    async (claims) => {
      const getToken = vi.fn();
      server.auth.mockResolvedValue({
        userId: "user-a",
        orgId: "org-a",
        sessionClaims: { iss: issuer },
        getToken,
      });
      const response = await postWithToken(signedToken(claims));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "DENIED" });
      expect(getToken).not.toHaveBeenCalled();
      expect(server.fetchAction).not.toHaveBeenCalled();
    },
  );

  it.each(["", "malformed-SENTINEL-token", "x".repeat(16_385)])(
    "refuses invalid token input without minting a replacement",
    async (token) => {
      const getToken = vi.fn();
      server.auth.mockResolvedValue({
        userId: "user-a",
        orgId: "org-a",
        sessionClaims: { iss: issuer },
        getToken,
      });
      const response = await postWithToken(token);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "DENIED" });
      expect(getToken).not.toHaveBeenCalled();
      expect(server.fetchAction).not.toHaveBeenCalled();
    },
  );

  it("refuses a modified signature and a cross-origin request", async () => {
    server.auth.mockResolvedValue({
      userId: "user-a",
      orgId: "org-a",
      sessionClaims: { iss: issuer },
      getToken: vi.fn(),
    });
    const token = signedToken();
    const [header, payload, signature] = token.split(".");
    const tampered = `${header}.${payload}.${signature?.startsWith("A") ? "B" : "A"}${signature?.slice(1)}`;
    for (const response of [
      await postWithToken(tampered),
      await postWithToken(token, "https://untrusted.example"),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "DENIED" });
    }
    expect(server.fetchAction).not.toHaveBeenCalled();
  });

  it.each([
    { userId: null, orgId: null, sessionClaims: null },
    { userId: "user-a", orgId: null, sessionClaims: { iss: issuer } },
    { userId: "user-a", orgId: "org-a", sessionClaims: {} },
  ])(
    "requires an authenticated session with an active organization even with a valid Convex token",
    async (session) => {
      server.auth.mockResolvedValue({ ...session, getToken: vi.fn() });
      const response = await postWithToken(signedToken());
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "DENIED" });
      expect(server.fetchAction).not.toHaveBeenCalled();
    },
  );
});
