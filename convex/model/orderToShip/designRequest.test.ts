import { describe, expect, it } from "vitest";

import {
  checkDesignRequestFulfilment,
  isDesignRequestOverdue,
  planDesignRequestAssignment,
  planDesignRequestProgress,
  planDesignRequestQueueEdit,
  planSimilarDesignConfirmation,
  type DesignRequestState,
} from "./designRequest";

const specification = {
  styleCode: "RSC",
  internalLengthMm: 300,
  internalWidthMm: 200,
  internalHeightMm: 150,
  boardGrade: "KA125/C/KA125",
  printColourCount: 1,
};

const request = (
  overrides: Partial<DesignRequestState> = {},
): DesignRequestState => ({
  status: "OPEN",
  ...overrides,
});

describe("design request workflow", () => {
  it("assigns, starts, and submits work through explicit queue states", () => {
    expect(planDesignRequestAssignment(request(), "user_1")).toMatchObject({
      ok: true,
      value: { status: "ASSIGNED", assignedToUserId: "user_1" },
    });
    expect(
      planDesignRequestProgress(request({ status: "ASSIGNED" }), "IN_PROGRESS"),
    ).toStrictEqual({ ok: true, value: "IN_PROGRESS" });
    expect(
      planDesignRequestProgress(
        request({ status: "IN_PROGRESS" }),
        "IN_REVIEW",
      ),
    ).toStrictEqual({ ok: true, value: "IN_REVIEW" });
  });

  it("fulfils only from a released revision for the same product identity", () => {
    expect(
      checkDesignRequestFulfilment({
        request: request({ status: "IN_REVIEW" }),
        requestedCustomerProductCode: "FG-001",
        revisionStatus: "RELEASED",
        revisionCustomerProductCode: "FG-001",
      }),
    ).toStrictEqual({ ok: true, value: "FULFILLED" });
    expect(
      checkDesignRequestFulfilment({
        request: request({ status: "IN_REVIEW" }),
        requestedCustomerProductCode: "FG-001",
        revisionStatus: "RELEASED",
        revisionCustomerProductCode: "FG-002",
      }),
    ).toMatchObject({
      ok: false,
      error: { field: "customerProductCode" },
    });
  });

  it("reports overdue work without changing persisted status", () => {
    expect(isDesignRequestOverdue(request({ dueAt: 99 }), 100)).toBe(true);
    expect(
      isDesignRequestOverdue(request({ status: "FULFILLED", dueAt: 99 }), 100),
    ).toBe(false);
  });

  it("edits queue priority and due date without changing workflow state", () => {
    expect(
      planDesignRequestQueueEdit(request({ status: "IN_PROGRESS" }), {
        priority: "URGENT",
        dueAt: Date.UTC(2026, 7, 31, 12),
      }),
    ).toStrictEqual({
      ok: true,
      value: { priority: "URGENT", dueAt: Date.UTC(2026, 7, 31, 12) },
    });
  });

  it("rejects invalid dates and edits to closed requests", () => {
    expect(
      planDesignRequestQueueEdit(request(), {
        priority: "NORMAL",
        dueAt: 0,
      }),
    ).toMatchObject({ ok: false, error: { field: "dueAt" } });
    expect(
      planDesignRequestQueueEdit(request({ status: "FULFILLED" }), {
        priority: "LOW",
        dueAt: null,
      }),
    ).toMatchObject({ ok: false, error: { field: "status" } });
  });
});

describe("planSimilarDesignConfirmation", () => {
  it("requires an explicit reason and returns an advisory score", () => {
    expect(
      planSimilarDesignConfirmation({
        request: request({ status: "IN_REVIEW" }),
        requestedSpecification: specification,
        candidateSpecification: { ...specification, internalLengthMm: 305 },
        candidateRevisionStatus: "RELEASED",
        lineStatus: "AWAITING_DESIGN",
        reason: "Customer approved the existing dieline",
      }),
    ).toMatchObject({ ok: true, value: { score: 5 / 6 } });
  });

  it("never permits a closed request or an unexplained confirmation", () => {
    expect(
      planSimilarDesignConfirmation({
        request: request({ status: "FULFILLED" }),
        requestedSpecification: specification,
        candidateSpecification: specification,
        candidateRevisionStatus: "RELEASED",
        lineStatus: "AWAITING_DESIGN",
        reason: "short",
      }).ok,
    ).toBe(false);
  });
});
