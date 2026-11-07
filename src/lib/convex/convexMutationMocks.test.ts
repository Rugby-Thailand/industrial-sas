import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Ratchet for the strict mutation registry (tests/fixtures/convex-mutation.ts).
 * A local `vi.mock("convex/react")` that defines its own `useMutation` replaces
 * the strict global mock, so a wrong mutation can pass. These files predate the
 * registry; migrate one to `useMutation: getTestMutation` and delete it here.
 * The list may only shrink.
 */
const PERMISSIVE_MUTATION_MOCKS = new Set([
  "src/features/aiUsage/AiUsageScreen.test.tsx",
  "src/features/finishedGoods/BatchManager.test.tsx",
  "src/features/finishedGoods/FinishedGoodsTaskBack.test.tsx",
  "src/features/finishedGoods/HubLoadingHeader.test.tsx",
  "src/features/finishedGoods/MoveScreen.test.tsx",
  "src/features/finishedGoods/PackageScanScreen.test.tsx",
  "src/features/finishedGoods/PackingScreen.test.tsx",
  "src/features/finishedGoods/PalletScreens.a11y.test.tsx",
  "src/features/finishedGoods/PalletScreens.test.tsx",
  "src/features/finishedGoods/PlacementEditor.test.tsx",
  "src/features/finishedGoods/ProductBatches.navigation.test.tsx",
  "src/features/finishedGoods/ProductScreens.a11y.test.tsx",
  "src/features/finishedGoods/ProductScreens.test.tsx",
  "src/features/finishedGoods/StackScreen.test.tsx",
  "src/features/hr/AnnouncementsNotifications.test.tsx",
  "src/features/hr/CorrectionForm.independent.test.tsx",
  "src/features/hr/EmployeeForm.employment.test.tsx",
  "src/features/hr/EmployeeForm.memberScope.test.tsx",
  "src/features/hr/EmployeeGapDetails.test.tsx",
  "src/features/hr/EmployeeProfileSections.test.tsx",
  "src/features/hr/EmployeesNavigation.test.tsx",
  "src/features/hr/HolidayDraftGuard.independent.test.tsx",
  "src/features/hr/HrBack.test.tsx",
  "src/features/hr/HrBackNavigation.test.tsx",
  "src/features/hr/HrClientReactive.test.tsx",
  "src/features/hr/HrClientRecovery.test.tsx",
  "src/features/hr/HrClockRefresh.test.tsx",
  "src/features/hr/HrListReturn.test.tsx",
  "src/features/hr/HrLiveDayDrafts.test.tsx",
  "src/features/hr/HrOrgSettings.test.tsx",
  "src/features/hr/HrPagedRecovery.test.tsx",
  "src/features/hr/HrPagination.test.tsx",
  "src/features/hr/HrReviewCompletion.test.tsx",
  "src/features/hr/HrScreens.test.tsx",
  "src/features/hr/HrSimplification.test.tsx",
  "src/features/hr/Payslips.test.tsx",
  "src/features/hr/PeriodCreateGuard.independent.test.tsx",
  "src/features/hr/PeriodsScreen.guard.test.tsx",
  "src/features/hr/PolicyLeave.test.tsx",
  "src/features/hr/SettingsHoliday.guard.test.tsx",
  "src/features/hr/ShiftsRoster.test.tsx",
  "src/features/hr/ShortcutCustomizeScreen.test.tsx",
  "src/features/hr/ShortcutNavigation.test.tsx",
  "src/features/hr/TodayPendingGuard.independent.test.tsx",
  "src/features/hr/TodayScreen.independent.test.tsx",
  "src/features/storageLayouts/BuildingStatusToggle.test.tsx",
  "src/features/storageLayouts/StorageBuildingCompletion.test.tsx",
  "src/features/storageLayouts/StorageBuildingRecovery.test.tsx",
  "src/features/storageLayouts/StorageLayoutActions.test.tsx",
  "src/features/storageLayouts/StorageLayoutNavigation.test.tsx",
  "src/features/storageLayouts/StorageLayoutScreens.test.tsx",
  "src/features/storageLayouts/StorageLocationCatalogue.test.tsx",
  "src/features/storageLayouts/StoragePositions.a11y.test.tsx",
  "src/lib/FinishedGoodsBackPolicy.test.tsx",
  "src/lib/StorageLayoutsBackPolicy.test.tsx",
]);

const root = fileURLToPath(new URL("../../../", import.meta.url));
const mocksConvex = /vi\.(?:do)?[mM]ock\(\s*["']convex\/react["']/;
const ownMutation = /\buseMutation\s*:(?!\s*getTestMutation\b)/;

const permissive = globSync("{src,tests}/**/*.test.{ts,tsx}", { cwd: root })
  .filter((file) => {
    const source = readFileSync(`${root}${file}`, "utf8");
    return mocksConvex.test(source) && ownMutation.test(source);
  })
  .sort();

describe("Convex mutation mocks in tests", () => {
  it("adds no new local useMutation mock that bypasses the strict registry", () => {
    expect(
      permissive.filter((file) => !PERMISSIVE_MUTATION_MOCKS.has(file)),
    ).toEqual([]);
  });

  it("drops migrated files from the legacy list", () => {
    expect(
      [...PERMISSIVE_MUTATION_MOCKS].filter(
        (file) => !permissive.includes(file),
      ),
    ).toEqual([]);
  });
});
