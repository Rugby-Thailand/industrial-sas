import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { POST as UploadPost } from "./route";

const session = vi.hoisted(() => ({
  current: { userId: null as string | null, orgId: null as string | null },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    ...session.current,
    getToken: async () => "fixture-jwt",
  })),
}));

const bridge = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("convex/nextjs", () => ({ fetchMutation: bridge.mutate }));
let post: typeof UploadPost;
const callbackResults: unknown[] = [];
const registrations: { metadata: unknown; fileKeys: string[] }[] = [];

beforeAll(async () => {
  // Synthetic signing credentials: no real account or network writes.
  vi.stubEnv(
    "UPLOADTHING_TOKEN",
    Buffer.from(
      JSON.stringify({
        apiKey: "sk_upload_test_synthetic_signing_key",
        appId: "upload-test-app",
        regions: ["sea1"],
      }),
    ).toString("base64"),
  );
  vi.stubEnv("UPLOADTHING_IS_DEV", "false");
  vi.stubEnv("UPLOADTHING_LOG_LEVEL", "None");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/callback-result") {
        callbackResults.push(await request.json());
        return Response.json({ ok: true });
      }
      expect(new URL(request.url).pathname).toBe("/route-metadata");
      registrations.push(await request.json());
      return Response.json({ ok: true });
    }),
  );
  ({ POST: post } = await import("./route"));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  session.current = { userId: null, orgId: null };
  registrations.length = 0;
  callbackResults.length = 0;
  bridge.mutate
    .mockReset()
    .mockResolvedValue({ ok: true, value: { assetId: "asset-owned" } });
});

function requestUpload() {
  return post(
    new NextRequest(
      "https://planner.test/api/uploadthing?actionType=upload&slug=jobTicketImage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [{ name: "ticket.jpg", size: 1024, type: "image/jpeg" }],
          input: { warehouseId: "warehouse-a" },
        }),
      },
    ),
  );
}

describe("UploadThing POST organization authorization", () => {
  it("rejects signed-out callers before registering upload metadata", async () => {
    const response = await requestUpload();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).toEqual({ message: "Unauthorized" });
    expect(registrations).toEqual([]);
  });

  it("issues a signed upload URL to an organization member", async () => {
    session.current = { userId: "user_member", orgId: "org_a" };
    const response = await requestUpload();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        name: "ticket.jpg",
        url: expect.stringContaining("signature="),
      }),
    ]);
    expect(bridge.mutate).toHaveBeenCalledWith(
      expect.anything(),
      { warehouseId: "warehouse-a" },
      { token: "fixture-jwt" },
    );
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.metadata).toEqual({
      assetId: "asset-owned",
    });
  });

  it("must reject an org-less session instead of granting a signed upload URL", async () => {
    session.current = { userId: "user_no_org", orgId: null };
    const response = await requestUpload();
    const body = await response.json();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body).toEqual({ message: "Unauthorized" });
    expect(registrations).toEqual([]);
    const signedUploadAuthorizations = Array.isArray(body) ? body.length : 0;
    expect(signedUploadAuthorizations).toBe(0);
  });
});

it("refuses a denied warehouse intent before issuing provider upload authorization", async () => {
  session.current = { userId: "user_member", orgId: "org_a" };
  bridge.mutate.mockResolvedValue({ ok: false });
  expect((await requestUpload()).status).toBeGreaterThanOrEqual(400);
  expect(registrations).toEqual([]);
});

function callback(signatureValid: boolean) {
  const body = JSON.stringify({
    status: "uploaded",
    origin: "https://sea1.ingest.uploadthing.com",
    metadata: { assetId: "asset-owned" },
    file: {
      name: "ticket.webp",
      size: 123,
      type: "image/webp",
      customId: "asset-owned",
      key: "owned-file",
      fileHash: "hash",
      url: "https://utfs.io/f/owned-file",
      appUrl: "https://upload-test-app.ufs.sh/f/owned-file",
      ufsUrl: "https://upload-test-app.ufs.sh/f/owned-file",
    },
  });
  const signature =
    "hmac-sha256=" +
    (signatureValid
      ? createHmac("sha256", "sk_upload_test_synthetic_signing_key")
          .update(body)
          .digest("hex")
      : "a".repeat(64));
  return post(
    new NextRequest(
      "https://planner.test/api/uploadthing?slug=jobTicketImage",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "uploadthing-hook": "callback",
          "x-uploadthing-signature": signature,
        },
        body,
      },
    ),
  );
}
it("rejects forged provider callbacks before the Convex bridge", async () => {
  expect((await callback(false)).status).toBeGreaterThanOrEqual(400);
  expect(bridge.mutate).not.toHaveBeenCalled();
});
it("relays only a verified provider callback and returns the asset ID after finalization", async () => {
  bridge.mutate.mockResolvedValue(null);
  expect((await callback(true)).status).toBe(200);
  await vi.waitFor(() => expect(callbackResults).toHaveLength(1));
  expect(bridge.mutate).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    assetId: "asset-owned",
    fileKey: "owned-file",
    url: "https://upload-test-app.ufs.sh/f/owned-file",
    size: 123,
    mimeType: "image/webp",
    signature: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(callbackResults[0]).toMatchObject({
    callbackData: {
      assetId: "asset-owned",
      url: "https://upload-test-app.ufs.sh/f/owned-file",
    },
  });
});
