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
  auth: vi.fn(async () => session.current),
}));

let post: typeof UploadPost;
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
          input: null,
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
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.metadata).toEqual({
      userId: "user_member",
      orgId: "org_a",
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
