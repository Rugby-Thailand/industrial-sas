import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";

import { completeUploadThingFile } from "../../convex/lib/uploadThingComplete";
import { signUploadThingCompletion } from "../../src/server/files/uploadThingReceipt";

type HttpRuntime = {
  readonly _handler: (ctx: unknown, request: Request) => Promise<Response>;
};

const invoke = (ctx: unknown, request: Request) =>
  (completeUploadThingFile as unknown as HttpRuntime)._handler(ctx, request);

const payload = {
  scope: "MASTER_CARD" as const,
  grantId: "grant_private_1",
  providerKey: "provider_private_1",
  uploaderClerkUserId: "user_clerk_owner_1",
  contentDigest:
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  contentType: "application/pdf",
  byteSize: 3,
};

describe("UploadThing completion boundary", () => {
  const previous = process.env.UPLOADTHING_TOKEN;

  beforeEach(() => {
    process.env.UPLOADTHING_TOKEN = "test-server-shared-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previous === undefined) delete process.env.UPLOADTHING_TOKEN;
    else process.env.UPLOADTHING_TOKEN = previous;
  });

  it("accepts a signed raw payload and forwards only verified metadata", async () => {
    const body = JSON.stringify(payload);
    const signature = await signUploadThingCompletion(
      body,
      process.env.UPLOADTHING_TOKEN!,
    );
    const runMutation = vi.fn(async () => true);
    const response = await invoke(
      { runMutation },
      new Request("https://convex.invalid/internal/uploadthing/complete", {
        method: "POST",
        headers: { "x-industrial-file-signature": signature },
        body,
      }),
    );

    expect(response.status).toBe(204);
    const { scope: _scope, ...completion } = payload;
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), completion);
  });

  it("refuses a tampered payload before invoking Convex", async () => {
    const original = JSON.stringify(payload);
    const signature = await signUploadThingCompletion(
      original,
      process.env.UPLOADTHING_TOKEN!,
    );
    const runMutation = vi.fn();
    const response = await invoke(
      { runMutation },
      new Request("https://convex.invalid/internal/uploadthing/complete", {
        method: "POST",
        headers: { "x-industrial-file-signature": signature },
        body: JSON.stringify({ ...payload, byteSize: 4 }),
      }),
    );

    expect(response.status).toBe(401);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("reports an expired or consumed grant as a conflict", async () => {
    const body = JSON.stringify(payload);
    const signature = await signUploadThingCompletion(
      body,
      process.env.UPLOADTHING_TOKEN!,
    );
    const response = await invoke(
      { runMutation: vi.fn(async () => false) },
      new Request("https://convex.invalid/internal/uploadthing/complete", {
        method: "POST",
        headers: { "x-industrial-file-signature": signature },
        body,
      }),
    );

    expect(response.status).toBe(409);
  });

  it("routes an operator-task receipt only to the task grant completer", async () => {
    const taskPayload = { ...payload, scope: "OPERATOR_TASK" as const };
    const body = JSON.stringify(taskPayload);
    const signature = await signUploadThingCompletion(
      body,
      process.env.UPLOADTHING_TOKEN!,
    );
    let calledPath = "";
    const runMutation = vi.fn(
      async (reference: FunctionReference<"mutation">, _args: unknown) => {
        calledPath = getFunctionName(reference);
        return true;
      },
    );
    const response = await invoke(
      { runMutation },
      new Request("https://convex.invalid/internal/uploadthing/complete", {
        method: "POST",
        headers: { "x-industrial-file-signature": signature },
        body,
      }),
    );

    expect(response.status).toBe(204);
    expect(calledPath).toBe(
      "lib/taskFileComplete:completeUploadThingTaskUploadGrant",
    );
  });

  it("routes a transport receipt only to the transport grant completer", async () => {
    const transportPayload = { ...payload, scope: "TRANSPORT" as const };
    const body = JSON.stringify(transportPayload);
    const signature = await signUploadThingCompletion(
      body,
      process.env.UPLOADTHING_TOKEN!,
    );
    let calledPath = "";
    const runMutation = vi.fn(
      async (reference: FunctionReference<"mutation">, _args: unknown) => {
        calledPath = getFunctionName(reference);
        return true;
      },
    );
    const response = await invoke(
      { runMutation },
      new Request("https://convex.invalid/internal/uploadthing/complete", {
        method: "POST",
        headers: { "x-industrial-file-signature": signature },
        body,
      }),
    );

    expect(response.status).toBe(204);
    expect(calledPath).toBe(
      "lib/transportFileComplete:completeUploadThingTransportFileGrant",
    );
  });
});
