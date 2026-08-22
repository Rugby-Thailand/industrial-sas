import { describe, expect, it } from "vitest";

import {
  MAX_QUEUED_INTENTS,
  describeAvailability,
  emptyIntentQueue,
  failIntent,
  markSending,
  nextIntent,
  pendingCount,
  settleIntent,
  submitIntent,
  type IntentQueue,
} from "./intentQueue";

const QUEUEABLE = "platform.device.seen";
const BLOCKED = "receiving.receipt.post";

const offer = (
  queue: IntentQueue,
  overrides: Partial<Parameters<typeof submitIntent>[1]> = {},
) =>
  submitIntent(queue, {
    requestId: "req-1",
    operation: QUEUEABLE,
    args: { installationId: "installation-0001" },
    capturedAt: 1_700_000_000_000,
    connection: "DISCONNECTED",
    ...overrides,
  });

describe("submitting an intent", () => {
  it("sends a queueable command while connected", () => {
    const outcome = offer(emptyIntentQueue(), { connection: "CONNECTED" });
    expect(outcome.kind).toBe("SEND");
    expect(outcome.queue.intents).toHaveLength(0);
  });

  it("queues a queueable command while disconnected, as pending", () => {
    const outcome = offer(emptyIntentQueue());
    expect(outcome.kind).toBe("QUEUED");
    expect(outcome.queue.intents[0]).toMatchObject({
      requestId: "req-1",
      state: "PENDING",
      attempts: 0,
    });
  });

  it("refuses a blocked command and remembers nothing about it", () => {
    const outcome = offer(emptyIntentQueue(), { operation: BLOCKED });
    expect(outcome.kind).toBe("BLOCKED");
    expect(outcome.queue.intents).toHaveLength(0);
  });

  it("keeps the original request id when the same intent is offered twice", () => {
    const first = offer(emptyIntentQueue());
    const second = offer(first.queue, { capturedAt: 1_700_000_999_999 });
    expect(second.queue.intents).toHaveLength(1);
    expect(second.queue.intents[0]!.capturedAt).toBe(1_700_000_000_000);
  });

  it("drops the oldest intent past the cap and reports it", () => {
    let queue = emptyIntentQueue();
    for (let index = 0; index <= MAX_QUEUED_INTENTS; index += 1) {
      queue = offer(queue, { requestId: `req-${index}` }).queue;
    }
    expect(queue.intents).toHaveLength(MAX_QUEUED_INTENTS);
    expect(queue.intents[0]!.requestId).toBe("req-1");
    expect(queue.dropped.map((intent) => intent.requestId)).toEqual(["req-0"]);
  });

  it("never drops an intent whose delivery is already in flight", () => {
    let queue = emptyIntentQueue();
    for (let index = 0; index < MAX_QUEUED_INTENTS; index += 1) {
      queue = offer(queue, { requestId: `req-${index}` }).queue;
    }
    queue = markSending(queue, "req-0");

    const overflow = offer(queue, { requestId: "req-new" });
    expect(overflow.kind).toBe("QUEUED");
    expect(overflow.queue.intents).toHaveLength(MAX_QUEUED_INTENTS);
    expect(overflow.queue.intents[0]).toMatchObject({
      requestId: "req-0",
      state: "SENDING",
    });
    expect(overflow.queue.dropped.map((intent) => intent.requestId)).toEqual([
      "req-1",
    ]);
  });

  it("refuses a new intent when every bounded slot is in flight", () => {
    let queue = emptyIntentQueue();
    for (let index = 0; index < MAX_QUEUED_INTENTS; index += 1) {
      queue = offer(queue, { requestId: `req-${index}` }).queue;
      queue = markSending(queue, `req-${index}`);
    }

    const overflow = offer(queue, { requestId: "req-new" });
    expect(overflow).toMatchObject({
      kind: "BLOCKED",
      reasonCode: "intentQueueFull",
    });
    expect(overflow.queue).toBe(queue);
    expect(overflow.queue.dropped).toHaveLength(0);
  });
});

describe("draining the queue", () => {
  it("hands back the oldest intent that is not already in flight", () => {
    const first = offer(emptyIntentQueue(), { requestId: "req-1" });
    const second = offer(first.queue, { requestId: "req-2" });
    expect(nextIntent(second.queue)?.requestId).toBe("req-1");

    const sending = markSending(second.queue, "req-1");
    expect(nextIntent(sending)?.requestId).toBe("req-2");
    expect(sending.intents[0]!.attempts).toBe(1);
  });

  it("removes an accepted intent rather than marking it done", () => {
    const queued = offer(emptyIntentQueue()).queue;
    const settled = settleIntent(queued, "req-1");
    expect(settled.intents).toHaveLength(0);
    expect(
      settled.intents.some((intent) => intent.state === ("SUCCEEDED" as never)),
    ).toBe(false);
  });

  it("keeps a failed intent and its request id, so a retry is a replay", () => {
    const queued = offer(emptyIntentQueue()).queue;
    const failed = failIntent(markSending(queued, "req-1"), "req-1", "TIMEOUT");
    expect(failed.intents[0]).toMatchObject({
      requestId: "req-1",
      state: "FAILED",
      lastErrorCode: "TIMEOUT",
      attempts: 1,
    });
    expect(nextIntent(failed)?.requestId).toBe("req-1");
  });

  it("counts everything not in flight as pending", () => {
    const first = offer(emptyIntentQueue(), { requestId: "req-1" }).queue;
    const second = offer(first, { requestId: "req-2" }).queue;
    expect(pendingCount(second)).toBe(2);
    expect(pendingCount(markSending(second, "req-1"))).toBe(1);
  });
});

describe("availability", () => {
  it("explains why a posting is unavailable while disconnected", () => {
    expect(
      describeAvailability({
        operation: BLOCKED,
        connection: "DISCONNECTED",
      }),
    ).toEqual({
      available: false,
      queueable: false,
      reasonCode: "postingReadsCurrentStock",
    });
  });

  it("marks a queueable command available and names its queue reason", () => {
    expect(
      describeAvailability({
        operation: QUEUEABLE,
        connection: "DISCONNECTED",
      }),
    ).toEqual({
      available: true,
      queueable: true,
      reasonCode: "deviceSeenIsCorrelationOnly",
    });
  });

  it("reports a connected command as available with no reason to show", () => {
    expect(
      describeAvailability({ operation: BLOCKED, connection: "CONNECTED" }),
    ).toEqual({ available: true, queueable: false, reasonCode: null });
  });

  it("refuses a posting whose reference data is stale, even connected", () => {
    expect(
      describeAvailability({
        operation: BLOCKED,
        connection: "CONNECTED",
        referenceDataStale: true,
      }),
    ).toMatchObject({ available: false, reasonCode: "referenceDataStale" });
  });
});
