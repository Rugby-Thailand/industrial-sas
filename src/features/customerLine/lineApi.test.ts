import { describe, expect, it } from "vitest";
import {
  customerLineGroupPath,
  readLineWriteOutcome,
  resolveLineWebhookUrl,
} from "./lineApi";

describe("customerLine API helpers", () => {
  it("derives webhook URL from explicit site URL first, then .convex.cloud fallback", () => {
    expect(
      resolveLineWebhookUrl("/webhooks/customer-line/uuid-1", {
        siteUrl: "https://custom.yongkit.example/",
        convexUrl: "https://ignored.convex.cloud",
      }),
    ).toBe("https://custom.yongkit.example/webhooks/customer-line/uuid-1");

    expect(
      resolveLineWebhookUrl("webhooks/customer-line/uuid-2", {
        siteUrl: "",
        convexUrl: "https://happy-otter-123.convex.cloud",
      }),
    ).toBe("https://happy-otter-123.convex.site/webhooks/customer-line/uuid-2");

    expect(
      resolveLineWebhookUrl("/webhooks/customer-line/uuid-3", {
        siteUrl: "",
        convexUrl: "",
      }),
    ).toBe("/webhooks/customer-line/uuid-3");
  });

  it("interprets TenantFunctionOutcome envelopes and safe domain errors", () => {
    expect(readLineWriteOutcome({ ok: true, value: null })).toEqual({
      ok: true,
    });
    expect(
      readLineWriteOutcome({
        ok: true,
        value: { _id: "conn-1", name: "Yongkit OA" },
      }),
    ).toEqual({ ok: true });
    expect(
      readLineWriteOutcome({
        ok: false,
        denial: { code: "FORBIDDEN", requestId: "req-1" },
      }),
    ).toEqual({ ok: false, code: "DENIED" });
    expect(
      readLineWriteOutcome({
        ok: true,
        value: { ok: false, code: "VERSION_CONFLICT" },
      }),
    ).toEqual({ ok: false, code: "VERSION_CONFLICT" });
    expect(
      readLineWriteOutcome({
        ok: true,
        value: { code: "LINE_CREDENTIALS_INVALID" },
      }),
    ).toEqual({ ok: false, code: "LINE_CREDENTIALS_INVALID" });
    expect(
      readLineWriteOutcome({
        ok: true,
        value: { code: "UNLISTED_CORE_FAILURE" },
      }),
    ).toEqual({ ok: false, code: "UNKNOWN" });
    expect(
      readLineWriteOutcome({
        ok: true,
        value: { ok: false, code: "SOMETHING_UNLISTED" },
      }),
    ).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("encodes group IDs safely in route paths", () => {
    expect(customerLineGroupPath("grp_123")).toBe(
      "/master-data/customers/line/grp_123",
    );
    expect(customerLineGroupPath("grp/with spaces")).toBe(
      "/master-data/customers/line/grp%2Fwith%20spaces",
    );
  });
});
