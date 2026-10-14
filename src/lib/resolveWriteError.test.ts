import { describe, expect, it } from "vitest";
import enMessages from "../../messages/en.json";
import thMessages from "../../messages/th.json";
import { unitCopy } from "@/features/finishedGoods/storageUnitLabels";
import { resolveWriteError } from "./resolveWriteError";

const translate = (messages: Record<string, string>) =>
  Object.assign(
    (key: string) => {
      if (!Object.hasOwn(messages, key))
        throw new Error(`Missing translation: ${key}`);
      return messages[key]!;
    },
    { has: (key: string) => Object.hasOwn(messages, key) },
  );
const en = translate(enMessages.WriteError);
const th = translate(thMessages.WriteError);

describe("resolveWriteError", () => {
  it("preserves domain-specific instructions and physical unit wording", () => {
    const goods = resolveWriteError(
      "DIMENSIONS_UNCHECKED",
      en,
      "finishedGoods",
    );
    const packing = resolveWriteError("DIMENSIONS_UNCHECKED", en, "packing");
    expect(goods).toContain("actual outside dimensions");
    expect(packing).not.toBe(goods);
    expect(
      unitCopy(resolveWriteError("MEASUREMENTS_REQUIRED", en), "BOX"),
    ).toContain("box length");
  });

  it("resolves specific errors from the real English and Thai catalogues", () => {
    expect(resolveWriteError("DUPLICATE_KEY", en)).toContain(
      "SKU already exists",
    );
    expect(resolveWriteError("DUPLICATE_KEY", th)).toContain(
      "รหัสสินค้านี้มีแล้ว",
    );
    expect(resolveWriteError("STACK_SUPPORT_MOVING", en)).toContain(
      "active move",
    );
    expect(resolveWriteError("STACK_SUPPORT_MOVING", th)).toContain("งานย้าย");
  });

  it.each([
    ["en", en],
    ["th", th],
  ] as const)(
    "explains confirmed finished-goods refusals instead of the generic %s retry",
    (_locale, catalogue) => {
      // Codes returned by finished-goods mutations (workflow, batches,
      // batchManagement and jobScans) that previously fell back to FG_UNKNOWN.
      const codes = [
        "PRODUCT_ALREADY_ACTIVE",
        "PRODUCT_DRAFT",
        "LOCATION_GEOMETRY_UNKNOWN",
        "LOCATION_ONLY_ACTION_UNAVAILABLE",
        "SCAN_GROUP_SIZE_INVALID",
        "STACK_SETTINGS_STALE",
      ];
      const generic = resolveWriteError("NOT_A_REAL_CODE", catalogue);
      const messages = codes.map((code) => resolveWriteError(code, catalogue));
      expect(messages).not.toContain(generic);
      expect(new Set(messages).size).toBe(codes.length);
    },
  );

  it("never exposes an arbitrary backend message", () => {
    const backendText = "Convex internal stack trace: secret details";
    expect(resolveWriteError(backendText, en)).toBe(
      enMessages.WriteError.FG_UNKNOWN,
    );
    expect(resolveWriteError(backendText, th)).toBe(
      thMessages.WriteError.FG_UNKNOWN,
    );
    expect(resolveWriteError(backendText, en, "storage")).toBe(
      enMessages.WriteError.UNKNOWN,
    );
  });
});
