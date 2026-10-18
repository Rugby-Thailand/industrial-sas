/**
 * Kiro audit probes — finished-goods frontend/backend code contracts.
 * Pure probes over the real UI mapping functions and the real message
 * catalogue. Each test asserts the EXPECTED behaviour; a failure on current
 * source is the evidence. No network, Convex or browser is involved.
 *
 * Run: pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/kiro/vitest.config.mts fg
 */
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

// PalletScreens imports routing/Convex modules; only the pure helper is used.
vi.mock("next/navigation", () => ({
  useRouter: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({}),
  usePathname: () => "/",
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));

import { messagesFor } from "@/i18n/messages";
import { resolveWriteError } from "@/lib/resolveWriteError";
import { recommendationReason } from "@/features/finishedGoods/recommendationReason";

const en = (english: string) => english;
const th = (_english: string, thai: string) => thai;

/** Reasons that convex/finishedGoods/workflow.ts `recommendations` can emit. */
const EMITTED_REASONS = [
  // workflow.ts:981-983 — a location holding units without coordinates.
  "LOCATION_GEOMETRY_UNKNOWN",
  // workflow.ts:984-987
  "STORAGE_CONDITION_MISMATCH",
  // workflow.ts:988-991
  "NO_SUPPORT_SURFACE",
  // workflow.ts:1004-1007 via validateStack (workflow.ts:2269-2318)
  "STACK_PALLET_ONLY",
  "PALLET_SUPPORTING_STACK",
  "STACK_CYCLE",
  "STACK_SUPPORT_UNAVAILABLE",
  "STACK_SUPPORT_MOVING",
  "STACK_LIMITS_REQUIRED",
  "STACK_LEVELS_EXCEEDED",
  "STACK_SUPPORT_OCCUPIED",
  // workflow.ts:1039-1043
  "HEIGHT_EXCEEDED",
  "NO_FREE_FOOTPRINT",
  // workflow.ts:1068
  "NO_ACTIVE_LOCATIONS",
] as const;

describe("recommendation 'no suitable space' reasons", () => {
  const generic = recommendationReason("__UNMAPPED__", en);

  it("K-FG-01 every reason the server emits has its own explanation", () => {
    const table = EMITTED_REASONS.map((code) => ({
      code,
      en: recommendationReason(code, en),
      th: recommendationReason(code, th),
    }));
    const fallback = table.filter((row) => row.en === generic);
    console.info(
      "K-FG-01 reasons that fall back to the generic sentence:",
      fallback.map((row) => row.code),
      "\n generic en:",
      JSON.stringify(generic),
      "\n generic th:",
      JSON.stringify(recommendationReason("__UNMAPPED__", th)),
    );
    expect(fallback.map((row) => row.code)).toEqual([]);
  });

  it("K-FG-01b two different blocking reasons never render the same sentence twice", () => {
    // PalletScreens.tsx:818-820 / MoveScreen.tsx:252-254 render one <li> per reason.
    const rendered = ["LOCATION_GEOMETRY_UNKNOWN", "STACK_LIMITS_REQUIRED"].map(
      (code) => recommendationReason(code, en),
    );
    console.info("K-FG-01b rendered list:", rendered);
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});

describe("finished-goods write refusals", () => {
  const t = createTranslator({
    locale: "en",
    messages: messagesFor("en"),
    namespace: "WriteError",
  });
  const translate = Object.assign((key: string) => t(key as never), {
    has: (key: string) => t.has(key as never),
  });
  const generic = translate("FG_UNKNOWN");

  /** Codes returned by finished-goods mutations, with source lines. */
  const MUTATION_CODES = {
    // saveProduct, workflow.ts:282-283
    PRODUCT_ALREADY_ACTIVE: "saveProduct",
    // createPallet/createPacking, workflow.ts:381, :429
    PRODUCT_DRAFT: "createPallet/createPacking",
    // reserve/reserveMove, workflow.ts:1299-1300, :1847-1848
    LOCATION_GEOMETRY_UNKNOWN: "reserve/reserveMove",
    // reserveMove/saveStackingLimits, workflow.ts:1814-1815, :2346-2347
    LOCATION_ONLY_ACTION_UNAVAILABLE: "reserveMove/saveStackingLimits",
    // jobScans.ts:73-74, :272-273
    SCAN_GROUP_SIZE_INVALID: "saveJobScanGroup",
  } as const;

  it("K-FG-02 refusal codes the server returns have specific copy instead of 'check your input and connection'", () => {
    const generic_ = Object.entries(MUTATION_CODES)
      .filter(([code]) => resolveWriteError(code, translate) === generic)
      .map(([code, mutation]) => `${code} (${mutation})`);
    console.info(
      "K-FG-02 codes shown as generic FG_UNKNOWN:",
      generic_,
      "\n generic:",
      JSON.stringify(generic),
    );
    expect(generic_).toEqual([]);
  });
});
