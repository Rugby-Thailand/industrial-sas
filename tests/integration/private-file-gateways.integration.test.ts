import { describe, expect, it, vi } from "vitest";

import { privateMasterCardFileDownload } from "../../convex/lib/privateFileDownload";
import { privateMasterCardFileUpload } from "../../convex/lib/privateFileUpload";

type HttpRuntime = {
  readonly _handler: (ctx: unknown, request: Request) => Promise<Response>;
};

const invoke = (action: unknown, ctx: unknown, request: Request) =>
  (action as HttpRuntime)._handler(ctx, request);

describe("private file HTTP gateways", () => {
  it("stores bytes only after a one-use claim and binds the exact storage ID", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ kind: "CLAIMED" })
      .mockResolvedValueOnce(true);
    const store = vi.fn(async () => "storage_bound_1");
    const remove = vi.fn(async () => undefined);
    const response = await invoke(
      privateMasterCardFileUpload,
      { runMutation, storage: { store, delete: remove } },
      new Request(
        "https://files.invalid/private-master-card-file-upload?grantId=grant_1",
        {
          method: "POST",
          headers: { "content-type": "application/pdf" },
          body: "private dieline",
        },
      ),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ storageId: "storage_bound_1" });
    expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      grantId: "grant_1",
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      grantId: "grant_1",
      storageId: "storage_bound_1",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses a consumed upload capability before storing any bytes", async () => {
    const store = vi.fn(async () => "never");
    const response = await invoke(
      privateMasterCardFileUpload,
      {
        runMutation: vi.fn(async () => null),
        storage: { store, delete: vi.fn() },
      },
      new Request(
        "https://files.invalid/private-master-card-file-upload?grantId=consumed",
        { method: "POST", body: "bytes" },
      ),
    );
    expect(response.status).toBe(404);
    expect(store).not.toHaveBeenCalled();
  });

  it("replays a completed upload after the first success response was lost", async () => {
    const store = vi.fn();
    const response = await invoke(
      privateMasterCardFileUpload,
      {
        runMutation: vi.fn(async () => ({
          kind: "COMPLETE",
          storageId: "storage_already_bound",
        })),
        storage: { store, delete: vi.fn() },
      },
      new Request(
        "https://files.invalid/private-master-card-file-upload?grantId=replay",
        { method: "POST", body: "same retry" },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storageId: "storage_already_bound",
    });
    expect(store).not.toHaveBeenCalled();
  });

  it("removes orphaned bytes and releases the claim when binding fails", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ kind: "CLAIMED" })
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const remove = vi.fn(async () => undefined);
    const response = await invoke(
      privateMasterCardFileUpload,
      {
        runMutation,
        storage: {
          store: vi.fn(async () => "storage_orphan"),
          delete: remove,
        },
      },
      new Request(
        "https://files.invalid/private-master-card-file-upload?grantId=retryable",
        { method: "POST", body: "orphan candidate" },
      ),
    );
    expect(response.status).toBe(404);
    expect(remove).toHaveBeenCalledWith("storage_orphan");
    expect(runMutation).toHaveBeenNthCalledWith(3, expect.anything(), {
      grantId: "retryable",
    });
  });

  it("redeems downloads through the gateway without exposing the storage URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("approved dieline", {
        headers: { "content-type": "application/pdf" },
      }),
    );
    const response = await invoke(
      privateMasterCardFileDownload,
      {
        runMutation: vi.fn(async () => ({
          storageId: "storage_private_1",
          fileName: "approved.pdf",
        })),
        storage: {
          getUrl: vi.fn(async () => "https://storage.invalid/private-signed"),
        },
      },
      new Request(
        "https://files.invalid/private-master-card-file?grantId=download_1",
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("approved dieline");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "approved.pdf",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.invalid/private-signed",
      { redirect: "error" },
    );
  });
});
