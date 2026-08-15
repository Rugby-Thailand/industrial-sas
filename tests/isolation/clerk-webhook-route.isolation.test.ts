import { describe, expect, it } from "vitest";

import http from "../../convex/http";
import { clerkWebhook } from "../../convex/lib/clerkWebhook";
import { privateMasterCardFileDownload } from "../../convex/lib/privateFileDownload";
import {
  privateMasterCardFileUpload,
  privateMasterCardFileUploadOptions,
} from "../../convex/lib/privateFileUpload";

describe("public Clerk webhook route", () => {
  it("exposes only the reviewed webhook and private-file gateways", () => {
    expect([...http.exactRoutes.keys()]).toEqual([
      "/webhooks/clerk",
      "/private-master-card-file",
      "/private-master-card-file-upload",
    ]);
    expect([...http.prefixRoutes.keys()]).toEqual([]);

    const methods = http.exactRoutes.get("/webhooks/clerk");
    expect(methods === undefined ? [] : [...methods.keys()]).toEqual(["POST"]);
    expect(methods?.get("POST")).toBe(clerkWebhook);

    const download = http.exactRoutes.get("/private-master-card-file");
    expect(download === undefined ? [] : [...download.keys()]).toEqual(["GET"]);
    expect(download?.get("GET")).toBe(privateMasterCardFileDownload);

    const upload = http.exactRoutes.get("/private-master-card-file-upload");
    expect(upload === undefined ? [] : [...upload.keys()]).toEqual([
      "OPTIONS",
      "POST",
    ]);
    expect(upload?.get("OPTIONS")).toBe(privateMasterCardFileUploadOptions);
    expect(upload?.get("POST")).toBe(privateMasterCardFileUpload);
  });
});
