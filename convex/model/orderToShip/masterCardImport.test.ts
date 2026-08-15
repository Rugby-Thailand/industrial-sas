import { describe, expect, it } from "vitest";

import { previewMasterCardImport } from "./masterCardImport";

const row = (sourceRow: number, verified = false) => ({
  sourceRow,
  sourceReference: `legacy-${sourceRow}.pdf`,
  cardNumber: `MC-${sourceRow}`,
  customerId: "customer_1",
  customerProductCode: `FG-${sourceRow}`,
  name: `Card ${sourceRow}`,
  verified,
  specification: {
    styleCode: "RSC",
    internalLengthMm: 300,
    internalWidthMm: 200,
    internalHeightMm: 150,
    boardGrade: "KA125/C/KA125",
    printColourCount: 1,
  },
  files: [],
});

describe("previewMasterCardImport", () => {
  it("preserves source references and resumes after the last accepted row", () => {
    const preview = previewMasterCardImport([row(10), row(11)]);
    expect(preview.problems).toEqual([]);
    expect(preview.nextSourceRow).toBe(12);
    expect(preview.accepted[0]).toMatchObject({
      sourceReference: "legacy-10.pdf",
      revisionStatus: "DRAFT",
      needsReviewReasons: expect.arrayContaining(["legacyVerification"]),
    });
  });

  it("reports every duplicate in a chunk without silently applying it", () => {
    const preview = previewMasterCardImport([
      row(1),
      { ...row(2), cardNumber: "mc-1" },
      { ...row(3), customerProductCode: "fg-1" },
    ]);
    expect(preview.problems).toHaveLength(2);
    expect(preview.accepted).toHaveLength(1);
  });

  it("never fabricates maker-checker evidence for a verified legacy row", () => {
    const preview = previewMasterCardImport([row(1, true)]);
    expect(preview.accepted[0]).toMatchObject({
      revisionStatus: "DRAFT",
      needsReviewReasons: expect.arrayContaining(["legacyApproval"]),
    });
  });

  it("releases only with explicit, independent legacy approval evidence", () => {
    const complete = {
      ...row(1, true),
      legacyApproval: {
        authoredByUserId: "user_author",
        submittedByUserId: "user_submitter",
        decidedByUserId: "user_decider",
        decidedAt: 1_700_000_000_000,
        decisionNote: "Approved in the signed legacy register",
      },
      specification: {
        ...row(1).specification,
        productNameEn: "Legacy carton",
        productNameTh: "กล่องเดิม",
        sheetLengthMm: 700,
        sheetWidthMm: 450,
        fluteCode: "C",
        layers: [{ position: 1, paperCode: "KA125", grammageGsm: 125 }],
        route: [{ sequence: 1, workCenterCode: "PRN", operationCode: "PRINT" }],
        materials: [
          {
            itemCode: "BOARD",
            description: "Board",
            quantityPerUnit: 1,
            uom: "SHEET",
          },
        ],
        qualityRequirements: [
          { code: "BCT", description: "Compression", target: "4500 N" },
        ],
        calculations: [
          {
            name: "BCT",
            formulaVersion: "LEGACY-1",
            inputs: [{ name: "ECT", value: 7, unit: "kN/m" }],
            result: 4600,
            unit: "N",
            passed: true,
            verifiedByUserId: "user_verifier",
            verifiedAt: 1_700_000_000_000,
          },
        ],
      },
      files: [
        {
          fileKey: "DIELINE-1",
          fileName: "legacy.pdf",
          kind: "DIELINE" as const,
          contentType: "application/pdf",
          byteSize: 10,
          contentDigest: "a".repeat(64),
          storageId: "storage_1",
          uploadGrantId: "grant_1",
        },
      ],
    };
    expect(previewMasterCardImport([complete]).accepted[0]).toMatchObject({
      revisionStatus: "RELEASED",
      needsReviewReasons: [],
    });
    expect(
      previewMasterCardImport([
        {
          ...complete,
          legacyApproval: {
            ...complete.legacyApproval,
            decidedByUserId: complete.legacyApproval.authoredByUserId,
          },
        },
      ]).accepted[0],
    ).toMatchObject({
      revisionStatus: "DRAFT",
      needsReviewReasons: expect.arrayContaining(["legacyApproval"]),
    });
  });
});
