import { describe, expect, it, vi } from "vitest";
import { finishedGoodsList } from "@tests/fixtures/finished-goods-ui";
import { unitNextAction } from "./unitNextAction";

vi.mock("@/i18n/navigation", () => ({ Link: () => null }));

const unit = finishedGoodsList.pallets[0]!;

describe("unit next action", () => {
  it("lets legacy and batch unmeasured units continue to scanning", () => {
    expect(unitNextAction(unit, true).href).toBe("/finished-goods/scan");
    expect(
      unitNextAction({ ...unit, preparationBatchId: "batch-a" }, true).href,
    ).toBe("/finished-goods/scan");
  });

  it("takes measured units directly to storage and reservations to verification", () => {
    expect(
      unitNextAction({ ...unit, status: "AWAITING_PLACEMENT" }, true),
    ).toEqual({
      href: "/finished-goods/pallets/pallet-a/storage",
      label: ["Choose storage", "เลือกจุดจัดเก็บ"],
    });
    expect(unitNextAction({ ...unit, status: "RESERVED" }, true)).toEqual({
      href: "/finished-goods/pallets/pallet-a",
      label: ["Continue placement", "ดำเนินการจัดเก็บต่อ"],
    });
  });

  it.each(["RESERVED", "IN_TRANSIT"] as const)(
    "resumes an active %s move instead of treating the unit as stored",
    (moveStatus) => {
      expect(
        unitNextAction({ ...unit, status: "STORED", moveStatus }, true),
      ).toEqual({
        href: "/finished-goods/pallets/pallet-a/move",
        label: ["Continue move", "ดำเนินการย้ายต่อ"],
      });
    },
  );

  it("does not offer a new move before the stored unit's support locks are known", () => {
    expect(unitNextAction({ ...unit, status: "STORED" }, true)).toEqual({
      href: "/finished-goods/pallets/pallet-a",
      label: ["View details", "ดูรายละเอียด"],
    });
  });

  it("keeps read-only and retired records on detail without offering changes", () => {
    for (const status of [
      "AWAITING_MEASUREMENT",
      "AWAITING_PLACEMENT",
      "RESERVED",
      "STORED",
    ] as const) {
      expect(
        unitNextAction({ ...unit, status, moveStatus: "IN_TRANSIT" }, false)
          .label[0],
      ).toBe("View details");
      expect(
        unitNextAction({ ...unit, status, retiredAt: 1000 }, true).label[0],
      ).toBe("View details");
    }
  });
});
