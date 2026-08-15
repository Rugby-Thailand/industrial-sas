import { describe, expect, it } from "vitest";

import {
  MASTER_CARD_REVISION_STATUSES,
  MAX_REVISION_NUMBER,
  checkFileAttachment,
  checkRevisionDecision,
  checkRevisionEdit,
  checkRevisionSubmission,
  checkSupersede,
  isEditable,
  isProductionVisible,
  nextRevisionNumber,
  type MasterCardRevisionState,
  type MasterCardRevisionStatus,
} from "./masterCardRevision";

const AUTHOR = "user_author";
const LEAD = "user_lead";
const APPROVER = "user_approver";

const revision = (
  status: MasterCardRevisionStatus,
  overrides: Partial<MasterCardRevisionState> = {},
): MasterCardRevisionState => ({
  status,
  authoredByUserId: AUTHOR,
  ...overrides,
});

describe("visibility and editability", () => {
  it.each(MASTER_CARD_REVISION_STATUSES)(
    "shows %s to production only when it is RELEASED",
    (status) => {
      expect(isProductionVisible(status)).toBe(status === "RELEASED");
    },
  );

  it.each(MASTER_CARD_REVISION_STATUSES)(
    "allows %s to be edited only while it is DRAFT",
    (status) => {
      expect(isEditable(status)).toBe(status === "DRAFT");
    },
  );

  it("keeps an in-review revision fixed while somebody reads it", () => {
    expect(isEditable("IN_REVIEW")).toBe(false);
  });
});

describe("nextRevisionNumber", () => {
  it("starts at one", () => {
    expect(nextRevisionNumber(undefined)).toStrictEqual({ ok: true, value: 1 });
  });

  it("increments past the highest number ever used, including rejected ones", () => {
    // Numbers are never reused: "rev 3" must mean one document forever.
    expect(nextRevisionNumber(3)).toStrictEqual({ ok: true, value: 4 });
  });

  it("refuses to exceed the ceiling", () => {
    expect(nextRevisionNumber(MAX_REVISION_NUMBER)).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "revisionNumber",
        reason: "TOO_MANY_REVISIONS",
      },
    });
  });
});

describe("checkRevisionEdit", () => {
  it("edits a draft", () => {
    expect(checkRevisionEdit(revision("DRAFT"))).toStrictEqual({
      ok: true,
      value: true,
    });
  });

  it("refuses a released revision by naming immutability", () => {
    // This refusal is what makes a pinned revision mean the same thing forever.
    expect(checkRevisionEdit(revision("RELEASED"))).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "RELEASED_IS_IMMUTABLE",
        status: "RELEASED",
      },
    });
  });

  it.each(["IN_REVIEW", "REJECTED", "SUPERSEDED"] as const)(
    "refuses a %s revision",
    (status) => {
      expect(checkRevisionEdit(revision(status))).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "NOT_DRAFT",
          status,
        },
      });
    },
  );
});

describe("checkFileAttachment", () => {
  it("attaches to a draft", () => {
    expect(checkFileAttachment(revision("DRAFT")).ok).toBe(true);
  });

  it.each(["IN_REVIEW", "RELEASED", "REJECTED", "SUPERSEDED"] as const)(
    "refuses to attach to a %s revision",
    (status) => {
      expect(checkFileAttachment(revision(status))).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "NOT_DRAFT",
          status,
        },
      });
    },
  );
});

describe("checkRevisionSubmission", () => {
  it("submits a draft that has artwork attached", () => {
    expect(
      checkRevisionSubmission(revision("DRAFT"), {
        attachedFileCount: 1,
        availableFileCount: 1,
        missingSpecificationFields: [],
      }),
    ).toStrictEqual({ ok: true, value: "IN_REVIEW" });
  });

  it("refuses metadata-only attachments that cannot be retrieved", () => {
    expect(
      checkRevisionSubmission(revision("DRAFT"), {
        attachedFileCount: 1,
        availableFileCount: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "NO_RETRIEVABLE_VERIFIED_FILES" },
    });
  });

  it("refuses an incomplete structured factory specification", () => {
    expect(
      checkRevisionSubmission(revision("DRAFT"), {
        attachedFileCount: 1,
        availableFileCount: 1,
        missingSpecificationFields: ["route"],
      }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "route",
        reason: "SPECIFICATION_INCOMPLETE",
      },
    });
  });

  it("refuses a draft with no files: approving it would sign off on nothing", () => {
    expect(
      checkRevisionSubmission(revision("DRAFT"), { attachedFileCount: 0 }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "files",
        reason: "NO_FILES_ATTACHED",
      },
    });
  });

  it.each(["IN_REVIEW", "RELEASED", "REJECTED", "SUPERSEDED"] as const)(
    "refuses to resubmit from %s",
    (status) => {
      expect(
        checkRevisionSubmission(revision(status), {
          attachedFileCount: 2,
          availableFileCount: 2,
        }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "NOT_DRAFT",
          status,
        },
      });
    },
  );
});

describe("checkRevisionDecision", () => {
  const inReview = revision("IN_REVIEW", { submittedByUserId: AUTHOR });

  it("releases on approval by somebody else", () => {
    expect(
      checkRevisionDecision(inReview, {
        deciderUserId: APPROVER,
        decision: "APPROVE",
      }),
    ).toStrictEqual({ ok: true, value: "RELEASED" });
  });

  it("rejects on rejection by somebody else", () => {
    expect(
      checkRevisionDecision(inReview, {
        deciderUserId: APPROVER,
        decision: "REJECT",
      }),
    ).toStrictEqual({ ok: true, value: "REJECTED" });
  });

  it("refuses the author, on approval and on rejection alike", () => {
    // A review the author can decide is a record of one person agreeing with
    // themselves — for approval *and* for rejection.
    for (const decision of ["APPROVE", "REJECT"] as const) {
      expect(
        checkRevisionDecision(inReview, { deciderUserId: AUTHOR, decision }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "SEPARATION_OF_DUTIES",
          field: "authoredByUserId",
          reason: "AUTHOR_CANNOT_DECIDE",
        },
      });
    }
  });

  it("refuses the submitter when a lead submitted somebody else's draft", () => {
    expect(
      checkRevisionDecision(
        revision("IN_REVIEW", { submittedByUserId: LEAD }),
        { deciderUserId: LEAD, decision: "APPROVE" },
      ),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "SEPARATION_OF_DUTIES",
        field: "submittedByUserId",
        reason: "SUBMITTER_CANNOT_DECIDE",
      },
    });
  });

  it("checks status before identity", () => {
    // A draft is not decidable by anyone, including a stranger to it.
    expect(
      checkRevisionDecision(revision("DRAFT"), {
        deciderUserId: APPROVER,
        decision: "APPROVE",
      }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "NOT_IN_REVIEW",
        status: "DRAFT",
      },
    });
  });

  it.each(["DRAFT", "RELEASED", "REJECTED", "SUPERSEDED"] as const)(
    "refuses a second decision from %s",
    (status) => {
      expect(
        checkRevisionDecision(revision(status), {
          deciderUserId: APPROVER,
          decision: "APPROVE",
        }).ok,
      ).toBe(false);
    },
  );
});

describe("checkSupersede", () => {
  it("supersedes a released revision with a newer one", () => {
    expect(
      checkSupersede(revision("RELEASED"), {
        previousRevisionNumber: 2,
        supersedingRevisionNumber: 3,
      }),
    ).toStrictEqual({ ok: true, value: true });
  });

  it("refuses to let an older revision demote the current spec", () => {
    expect(
      checkSupersede(revision("RELEASED"), {
        previousRevisionNumber: 5,
        supersedingRevisionNumber: 3,
      }),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        field: "revisionNumber",
        reason: "NOT_NEWER",
      },
    });
  });

  it.each(["DRAFT", "IN_REVIEW", "REJECTED", "SUPERSEDED"] as const)(
    "refuses to supersede a %s revision",
    (status) => {
      expect(
        checkSupersede(revision(status), {
          previousRevisionNumber: 1,
          supersedingRevisionNumber: 2,
        }),
      ).toStrictEqual({
        ok: false,
        error: {
          code: "ILLEGAL_TRANSITION",
          field: "status",
          reason: "NOT_RELEASED",
          status,
        },
      });
    },
  );
});
