import type { FinishedGoodsList } from "@/lib/convex/finishedGoodsApi";
import { palletPath, storagePath } from "./shared";

type Unit = FinishedGoodsList["pallets"][number];
type Action = { href: string; label: readonly [string, string] };

export function unitNextAction(unit: Unit, canManage: boolean): Action {
  const detail = {
    href: palletPath(unit._id),
    label: ["View details", "ดูรายละเอียด"] as const,
  };
  if (!canManage || unit.retiredAt) return detail;
  if (unit.moveStatus === "RESERVED" || unit.moveStatus === "IN_TRANSIT")
    return {
      href: `${palletPath(unit._id)}/move`,
      label: ["Continue move", "ดำเนินการย้ายต่อ"],
    };
  switch (unit.status) {
    case "AWAITING_MEASUREMENT":
      return {
        href: "/finished-goods/scan",
        label: ["Scan Packages", "สแกนบรรจุภัณฑ์"],
      };
    case "AWAITING_PLACEMENT":
      return unit.sameSize === undefined
        ? {
            href: storagePath(unit._id),
            label: ["Choose storage", "เลือกจุดจัดเก็บ"],
          }
        : {
            href: "/finished-goods/scan",
            label: ["Scan Packages", "สแกนบรรจุภัณฑ์"],
          };
    case "RESERVED":
      return {
        href: palletPath(unit._id),
        label: ["Continue placement", "ดำเนินการจัดเก็บต่อ"],
      };
    default:
      // List rows do not include support locks. The detail screen decides whether moving is allowed.
      return detail;
  }
}
