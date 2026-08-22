import { describe, expect, it } from "vitest";

import {
  TASK_LEASE_MS,
  decideClaim,
  decideCompletion,
  decideHeartbeat,
  decideReassign,
  decideRelease,
  describeLease,
  normalizeTaskReason,
  type OperatorTaskState,
} from "./taskAssignment";

const NOW = 1_700_000_000_000;

const available: OperatorTaskState = { status: "AVAILABLE" };
const heldBy = (
  userId: string,
  overrides: Partial<OperatorTaskState> = {},
): OperatorTaskState => ({
  status: "CLAIMED",
  claimedByUserId: userId,
  claimedAt: NOW - 1000,
  leaseExpiresAt: NOW + TASK_LEASE_MS,
  heartbeatAt: NOW - 1000,
  evidenceCount: 3,
  ...overrides,
});

describe("lease presentation", () => {
  it("reads an unclaimed task as unclaimed", () => {
    expect(describeLease(available, NOW)).toEqual({ kind: "UNCLAIMED" });
  });

  it("reports the holder and the time left", () => {
    expect(describeLease(heldBy("user_a"), NOW)).toEqual({
      kind: "HELD",
      holderUserId: "user_a",
      expiresAt: NOW + TASK_LEASE_MS,
      remainingMs: TASK_LEASE_MS,
    });
  });

  it("reads a lapsed lease as expired without writing anything", () => {
    const view = describeLease(
      heldBy("user_a", { leaseExpiresAt: NOW - 1 }),
      NOW,
    );
    expect(view).toEqual({
      kind: "EXPIRED",
      holderUserId: "user_a",
      expiredAt: NOW - 1,
    });
  });

  it("treats a claimed task with no expiry as expired, never as indefinite", () => {
    const view = describeLease(
      { status: "CLAIMED", claimedByUserId: "user_a" },
      NOW,
    );
    expect(view.kind).toBe("EXPIRED");
  });

  it("reads a finished task as closed", () => {
    expect(describeLease({ status: "COMPLETED" }, NOW)).toEqual({
      kind: "CLOSED",
      status: "COMPLETED",
    });
  });
});

describe("claim", () => {
  it("claims an available task and starts the lease", () => {
    const claim = decideClaim({
      task: available,
      actorUserId: "user_a",
      now: NOW,
    });
    expect(claim.ok && claim.value).toEqual({
      claimedByUserId: "user_a",
      claimedAt: NOW,
      leaseExpiresAt: NOW + TASK_LEASE_MS,
      heartbeatAt: NOW,
      alreadyHeld: false,
    });
  });

  it("re-claiming your own live task renews it and reports alreadyHeld", () => {
    const claim = decideClaim({
      task: heldBy("user_a"),
      actorUserId: "user_a",
      now: NOW + 1000,
    });
    expect(claim.ok && claim.value.alreadyHeld).toBe(true);
    expect(claim.ok && claim.value.claimedAt).toBe(NOW - 1000);
    expect(claim.ok && claim.value.leaseExpiresAt).toBe(
      NOW + 1000 + TASK_LEASE_MS,
    );
  });

  it("refuses a task another operator holds under a live lease", () => {
    const claim = decideClaim({
      task: heldBy("user_a"),
      actorUserId: "user_b",
      now: NOW,
    });
    expect(!claim.ok && claim.error.code).toBe("TASK_HELD_BY_ANOTHER_OPERATOR");
  });

  it("lets another operator take over a lapsed lease, naming the holder it took it from", () => {
    const claim = decideClaim({
      task: heldBy("user_a", { leaseExpiresAt: NOW - 1 }),
      actorUserId: "user_b",
      now: NOW,
    });
    expect(claim.ok && claim.value.takenOverFromUserId).toBe("user_a");
    expect(claim.ok && claim.value.alreadyHeld).toBe(false);
  });

  it("lets the original holder resume a lapsed lease without a handover", () => {
    const claim = decideClaim({
      task: heldBy("user_a", { leaseExpiresAt: NOW - 1 }),
      actorUserId: "user_a",
      now: NOW,
    });
    expect(claim.ok && claim.value.alreadyHeld).toBe(true);
    expect(claim.ok && "takenOverFromUserId" in claim.value).toBe(false);
  });

  it("refuses a completed task", () => {
    const claim = decideClaim({
      task: { status: "COMPLETED" },
      actorUserId: "user_a",
      now: NOW,
    });
    expect(!claim.ok && claim.error.code).toBe("TASK_NOT_CLAIMABLE");
  });

  it("refuses an unusable clock", () => {
    const claim = decideClaim({
      task: available,
      actorUserId: "user_a",
      now: Number.NaN,
    });
    expect(!claim.ok && claim.error.code).toBe("CLOCK_INVALID");
  });
});

describe("heartbeat", () => {
  it("extends the lease from the current instant", () => {
    const beat = decideHeartbeat({
      task: heldBy("user_a"),
      actorUserId: "user_a",
      now: NOW + 60_000,
    });
    expect(beat.ok && beat.value).toEqual({
      leaseExpiresAt: NOW + 60_000 + TASK_LEASE_MS,
      heartbeatAt: NOW + 60_000,
      recovered: false,
    });
  });

  it("recovers a lapsed lease the holder still owns", () => {
    const beat = decideHeartbeat({
      task: heldBy("user_a", { leaseExpiresAt: NOW - 1 }),
      actorUserId: "user_a",
      now: NOW,
    });
    expect(beat.ok && beat.value.recovered).toBe(true);
  });

  it("refuses a heartbeat from an operator who lost the task", () => {
    const beat = decideHeartbeat({
      task: heldBy("user_b"),
      actorUserId: "user_a",
      now: NOW,
    });
    expect(!beat.ok && beat.error.code).toBe("TASK_NOT_HELD_BY_ACTOR");
  });

  it("refuses a heartbeat on a task nobody claimed", () => {
    const beat = decideHeartbeat({
      task: available,
      actorUserId: "user_a",
      now: NOW,
    });
    expect(!beat.ok && beat.error.code).toBe("TASK_NOT_CLAIMED");
  });
});

describe("release", () => {
  it("returns the task with its evidence intact", () => {
    const release = decideRelease({
      task: heldBy("user_a"),
      actorUserId: "user_a",
      reason: " end of shift ",
      now: NOW,
    });
    expect(release.ok && release.value).toEqual({
      status: "AVAILABLE",
      releaseKind: "RELEASED",
      previousHolderUserId: "user_a",
      releasedAt: NOW,
      reason: "end of shift",
      retainedEvidenceCount: 3,
    });
  });

  it("requires a reason", () => {
    const release = decideRelease({
      task: heldBy("user_a"),
      actorUserId: "user_a",
      reason: "  ",
      now: NOW,
    });
    expect(!release.ok && release.error.code).toBe("REASON_REQUIRED");
  });

  it("refuses a release from somebody who does not hold it", () => {
    const release = decideRelease({
      task: heldBy("user_b"),
      actorUserId: "user_a",
      reason: "battery",
      now: NOW,
    });
    expect(!release.ok && release.error.code).toBe("TASK_NOT_HELD_BY_ACTOR");
  });

  it("bounds the reason", () => {
    expect(normalizeTaskReason("x".repeat(241)).ok).toBe(false);
  });
});

describe("reassignment", () => {
  it("moves a live lease to another operator and keeps the evidence", () => {
    const move = decideReassign({
      task: heldBy("user_a"),
      actorUserId: "supervisor_1",
      toUserId: "user_b",
      reason: "priority job",
      now: NOW,
    });
    expect(move.ok && move.value).toEqual({
      status: "CLAIMED",
      releaseKind: "REASSIGNED",
      previousHolderUserId: "user_a",
      claimedByUserId: "user_b",
      claimedAt: NOW,
      leaseExpiresAt: NOW + TASK_LEASE_MS,
      heartbeatAt: NOW,
      reason: "priority job",
      retainedEvidenceCount: 3,
    });
  });

  it("records a lapsed lease as the reason the task moved", () => {
    const move = decideReassign({
      task: heldBy("user_a", { leaseExpiresAt: NOW - 1 }),
      actorUserId: "supervisor_1",
      toUserId: "user_b",
      reason: "handheld went flat",
      now: NOW,
    });
    expect(move.ok && move.value.releaseKind).toBe("LEASE_EXPIRED");
  });

  it("assigns an unclaimed task without naming a previous holder", () => {
    const move = decideReassign({
      task: available,
      actorUserId: "supervisor_1",
      toUserId: "user_b",
      reason: "coverage",
      now: NOW,
    });
    expect(move.ok && "previousHolderUserId" in move.value).toBe(false);
  });

  it("refuses to reassign to the current holder", () => {
    const move = decideReassign({
      task: heldBy("user_b"),
      actorUserId: "supervisor_1",
      toUserId: "user_b",
      reason: "coverage",
      now: NOW,
    });
    expect(!move.ok && move.error.code).toBe("REASSIGN_TO_CURRENT_HOLDER");
  });

  it("refuses a supervisor reassigning work to themselves", () => {
    const move = decideReassign({
      task: heldBy("user_a"),
      actorUserId: "supervisor_1",
      toUserId: "supervisor_1",
      reason: "I will do it",
      now: NOW,
    });
    expect(!move.ok && move.error.code).toBe("REASSIGN_TO_SELF");
  });

  it("refuses to reassign a finished task", () => {
    const move = decideReassign({
      task: { status: "COMPLETED" },
      actorUserId: "supervisor_1",
      toUserId: "user_b",
      reason: "coverage",
      now: NOW,
    });
    expect(!move.ok && move.error.code).toBe("TASK_NOT_CLAIMABLE");
  });
});

describe("completion", () => {
  it("completes a task held under a live lease", () => {
    const done = decideCompletion({
      task: heldBy("user_a"),
      actorUserId: "user_a",
      now: NOW,
    });
    expect(done.ok && done.value).toEqual({
      status: "COMPLETED",
      completedByUserId: "user_a",
      completedAt: NOW,
    });
  });

  it("refuses to complete under a lapsed lease", () => {
    const done = decideCompletion({
      task: heldBy("user_a", { leaseExpiresAt: NOW - 1 }),
      actorUserId: "user_a",
      now: NOW,
    });
    expect(!done.ok && done.error.code).toBe("TASK_LEASE_EXPIRED");
  });

  it("refuses to complete somebody else's task", () => {
    const done = decideCompletion({
      task: heldBy("user_b"),
      actorUserId: "user_a",
      now: NOW,
    });
    expect(!done.ok && done.error.code).toBe("TASK_NOT_HELD_BY_ACTOR");
  });
});
