import { describe, expect, it } from "vitest";

import {
  COMMAND_CLASSIFICATIONS,
  classifyCommand,
  decideDispatch,
  isQueueable,
} from "./commandClassification";

describe("command classification", () => {
  it("classifies a device-seen ping as queueable", () => {
    const definition = classifyCommand("platform.device.seen");
    expect(definition.classification).toBe("QUEUEABLE");
    expect(definition.idempotent).toBe(true);
    expect(definition.dependsOnServerState).toBe(false);
  });

  it("blocks a heartbeat, because a replayed one asserts liveness that lapsed", () => {
    const definition = classifyCommand("work.task.heartbeat");
    expect(definition.classification).toBe("BLOCKED_OFFLINE");
    expect(definition.reasonCode).toBe("heartbeatProvesLivenessNow");
  });

  it("blocks evidence, because appending it needs a lease the queue cannot hold", () => {
    const definition = classifyCommand("work.evidence.record");
    expect(definition.classification).toBe("BLOCKED_OFFLINE");
    expect(definition.reasonCode).toBe("evidenceNeedsTaskLease");
  });

  it("blocks reporting and resolving task exceptions on stale state", () => {
    expect(classifyCommand("work.exception.report")).toMatchObject({
      classification: "BLOCKED_OFFLINE",
      reasonCode: "evidenceNeedsTaskLease",
    });
    expect(classifyCommand("work.exception.resolve")).toMatchObject({
      classification: "BLOCKED_OFFLINE",
      reasonCode: "approvalNeedsFreshIdentity",
    });
  });

  it("blocks every stock-affecting command", () => {
    for (const operation of [
      "receiving.receipt.post",
      "putaway.task.confirm",
      "inventory.transaction.post",
      "inventory.transaction.reverse",
      "quality.disposition.submit",
      "quality.disposition.approve",
    ]) {
      expect(classifyCommand(operation).classification).toBe("BLOCKED_OFFLINE");
    }
  });

  it("blocks a claim because it races another operator", () => {
    const definition = classifyCommand("work.task.claim");
    expect(definition.classification).toBe("BLOCKED_OFFLINE");
    expect(definition.reasonCode).toBe("claimRacesAnotherOperator");
  });

  it("blocks an operation nobody classified, and keeps its name", () => {
    const definition = classifyCommand("outbound.pick.confirm");
    expect(definition.classification).toBe("BLOCKED_OFFLINE");
    expect(definition.reasonCode).toBe("commandNotClassified");
    expect(definition.operation).toBe("outbound.pick.confirm");
  });

  it("treats a non-string operation as unclassified rather than throwing", () => {
    expect(classifyCommand(undefined as unknown as string).classification).toBe(
      "BLOCKED_OFFLINE",
    );
  });

  it("never marks a state-dependent or non-idempotent command queueable", () => {
    for (const definition of COMMAND_CLASSIFICATIONS) {
      if (definition.classification === "QUEUEABLE") {
        expect(definition.idempotent).toBe(true);
        expect(definition.dependsOnServerState).toBe(false);
      }
    }
  });

  it("exposes exactly one definition per operation", () => {
    const names = COMMAND_CLASSIFICATIONS.map(
      (definition) => definition.operation,
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("dispatch", () => {
  it("sends a blocked command while connected", () => {
    expect(
      decideDispatch({
        operation: "receiving.receipt.post",
        connection: "CONNECTED",
      }),
    ).toEqual({ kind: "SEND" });
  });

  it("refuses a blocked command while disconnected, with its reason", () => {
    expect(
      decideDispatch({
        operation: "receiving.receipt.post",
        connection: "DISCONNECTED",
      }),
    ).toEqual({ kind: "BLOCK", reasonCode: "postingReadsCurrentStock" });
  });

  it("refuses a blocked command whose reference data is stale, even connected", () => {
    expect(
      decideDispatch({
        operation: "putaway.task.confirm",
        connection: "CONNECTED",
        referenceDataStale: true,
      }),
    ).toEqual({ kind: "BLOCK", reasonCode: "referenceDataStale" });
  });

  it("queues a queueable command while disconnected", () => {
    expect(
      decideDispatch({
        operation: "platform.device.seen",
        connection: "DISCONNECTED",
      }),
    ).toEqual({ kind: "QUEUE", reasonCode: "deviceSeenIsCorrelationOnly" });
  });

  it("refuses a blocked command while connectivity is unknown", () => {
    expect(
      decideDispatch({
        operation: "inventory.transaction.post",
        connection: "UNKNOWN",
      }).kind,
    ).toBe("BLOCK");
  });

  it("queues a queueable command while connectivity is unknown", () => {
    expect(
      decideDispatch({
        operation: "platform.device.seen",
        connection: "UNKNOWN",
      }).kind,
    ).toBe("QUEUE");
  });

  it("stale reference data cannot make a queueable command block", () => {
    expect(
      decideDispatch({
        operation: "platform.device.seen",
        connection: "CONNECTED",
        referenceDataStale: true,
      }),
    ).toEqual({ kind: "SEND" });
  });

  it("isQueueable agrees with the catalogue", () => {
    expect(isQueueable("platform.device.seen")).toBe(true);
    expect(isQueueable("work.task.heartbeat")).toBe(false);
    expect(isQueueable("putaway.task.confirm")).toBe(false);
  });
});
