import { describe, expect, it } from "vitest";

import { classifyConnection, isServerHealthy } from "./connection";

import { resolveAppEnvironment } from "../environment";

const configured = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
  clerkPublishableKey: "pk_test_x",
});
const unconfigured = resolveAppEnvironment({});
const preview = resolveAppEnvironment({
  localPreviewFlag: "1",
  nodeEnv: "development",
});

describe("classifyConnection", () => {
  it("reports a live socket as connected", () => {
    expect(
      classifyConnection(configured, {
        isWebSocketConnected: true,
        hasEverConnected: true,
      }),
    ).toBe("CONNECTED");
  });

  it("distinguishes a first connection attempt from a dropped link", () => {
    // The two look identical to `navigator.onLine` and mean different things to
    // an operator: one is a page load, the other is a fault (`INV-0009-07`).
    expect(
      classifyConnection(configured, {
        isWebSocketConnected: false,
        hasEverConnected: false,
      }),
    ).toBe("CONNECTING");
    expect(
      classifyConnection(configured, {
        isWebSocketConnected: false,
        hasEverConnected: true,
      }),
    ).toBe("DISCONNECTED");
  });

  it("reports connecting while no acknowledgement has been observed", () => {
    expect(classifyConnection(configured, undefined)).toBe("CONNECTING");
  });

  it("reports an unconfigured deployment as such, not as disconnected", () => {
    expect(classifyConnection(unconfigured, undefined)).toBe("NOT_CONFIGURED");
  });

  it("names preview mode, and never calls it connected", () => {
    expect(
      classifyConnection(preview, {
        isWebSocketConnected: true,
        hasEverConnected: true,
      }),
    ).toBe("PREVIEW");
  });
});

describe("isServerHealthy", () => {
  it("is true only for a live server", () => {
    expect(isServerHealthy("CONNECTED")).toBe(true);
  });

  it("is false for preview, so synthetic data can never satisfy a gate", () => {
    expect(isServerHealthy("PREVIEW")).toBe(false);
    expect(isServerHealthy("CONNECTING")).toBe(false);
    expect(isServerHealthy("DISCONNECTED")).toBe(false);
    expect(isServerHealthy("NOT_CONFIGURED")).toBe(false);
  });
});
