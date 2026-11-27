import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.unmock("convex/react");

const sockets: TestSocket[] = [];
class TestSocket {
  onopen?: () => void;
  onclose?: (event: CloseEvent) => void;
  private handshaking = true;
  readonly sent: { type: string; sessionId?: string }[] = [];
  constructor() {
    sockets.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    if (!this.handshaking) return;
    this.handshaking = false;
    this.onopen?.();
  }
  close(code = 1006, reason = "") {
    this.handshaking = false;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }
}

function socketAt(index: number) {
  const socket = sockets[index];
  if (!socket) throw new Error(`Expected socket at index ${index}`);
  return socket;
}

let client: ConvexReactClient;
const visibility = (state: DocumentVisibilityState) => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  client = new ConvexReactClient("https://reconnect-test.convex.cloud", {
    webSocketConstructor: TestSocket as unknown as typeof WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  });
  client
    .watchQuery(makeFunctionReference<"query">("fixture:read"))
    .onUpdate(() => {});
  socketAt(0).open();
});

afterEach(async () => {
  // Complete any handshake so the real client's close promise can settle.
  sockets.at(-1)?.open();
  await client.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("reconnects the same subscribed session immediately on return and only once per outage", () => {
  void client.mutation(makeFunctionReference<"mutation">("fixture:save"));
  visibility("hidden");
  socketAt(0).close();
  expect(sockets).toHaveLength(1);
  visibility("visible");
  expect(sockets).toHaveLength(2);
  socketAt(1).close();
  visibility("hidden");
  visibility("visible");
  expect(sockets).toHaveLength(2);
  vi.advanceTimersByTime(5_000);
  expect(sockets).toHaveLength(3);
  socketAt(2).open();
  const original = socketAt(0).sent;
  const resumed = socketAt(2).sent;
  const originalSession = original.find((m) => m.type === "Connect")?.sessionId;
  expect(originalSession).toEqual(expect.any(String));
  expect(resumed.find((m) => m.type === "Connect")?.sessionId).toBe(
    originalSession,
  );
  const submission = original.filter((m) => m.type === "Mutation");
  expect(submission).toHaveLength(1);
  expect(resumed.filter((m) => m.type === "Mutation")).toEqual(submission);
  expect(resumed).toContainEqual(
    expect.objectContaining({
      type: "ModifyQuerySet",
      modifications: [
        expect.objectContaining({ type: "Add", udfPath: "fixture:read" }),
      ],
    }),
  );

  visibility("hidden");
  socketAt(2).close();
  visibility("visible");
  expect(sockets).toHaveLength(4);
});

it("respects the server backoff when staff return after a capacity error", () => {
  visibility("hidden");
  socketAt(0).close(1013, "TooManyConcurrentRequests");
  visibility("visible");
  expect(sockets).toHaveLength(1);
  vi.advanceTimersByTime(5_000);
  expect(sockets).toHaveLength(2);
});

it("keeps a healthy connection and waits while the browser is offline", () => {
  visibility("hidden");
  visibility("visible");
  expect(sockets).toHaveLength(1);
  visibility("hidden");
  socketAt(0).close();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  visibility("visible");
  expect(sockets).toHaveLength(1);
});
