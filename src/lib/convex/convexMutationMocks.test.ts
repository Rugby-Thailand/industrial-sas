import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Ratchet for the strict mutation registry (tests/fixtures/convex-mutation.ts).
 * A local `vi.mock("convex/react")` that supplies its own `useMutation` (in any
 * form: property, shorthand, method or `vi.mocked`) replaces the strict global
 * mock, so a wrong mutation can pass. So can a test helper that builds one.
 * These files predate the registry; migrate one to `useMutation: getTestMutation`
 * and delete it here. The list may only shrink.
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
const registry = "tests/fixtures/convex-mutation.ts";
const mocksConvex =
  /vi\.(?:do)?[mM]ock\(\s*(?:import\(\s*)?["']convex\/react["']/;
const comments = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
const strictMutation = /\buseMutation\s*:\s*getTestMutation\b/g;

/** Any `useMutation` left once the strict form is removed is a local mock. */
function bypassesRegistry(file: string, source: string) {
  const isHelper = !/\.(?:test|spec)\.tsx?$/.test(file);
  const code = source.replace(comments, "").replace(strictMutation, "");
  return (isHelper || mocksConvex.test(code)) && /\buseMutation\b/.test(code);
}

const files = new Set([
  ...globSync("{src,tests}/**/*.test.{ts,tsx}", { cwd: root }),
  ...globSync("tests/**/*.{ts,tsx}", { cwd: root }),
]);
// The registry defines the strict mock; this file holds detector samples.
files.delete(registry);
files.delete("src/lib/convex/convexMutationMocks.test.ts");
const permissive = [...files]
  .filter((file) =>
    bypassesRegistry(file, readFileSync(`${root}${file}`, "utf8")),
  )
  .sort();

describe("permissive mutation mock detection", () => {
  const mock = (factory: string) =>
    `vi.mock("convex/react", () => (${factory}));`;

  it.each([
    ["a property", mock("{ useMutation: () => vi.fn() }")],
    ["shorthand", `const useMutation = vi.fn();\n${mock("{ useMutation }")}`],
    ["a method", mock("{ useMutation() { return vi.fn(); } }")],
    [
      "a typed import() mock",
      'vi.mock(import("convex/react"), () => ({ useMutation: () => vi.fn() }));',
    ],
    [
      "vi.mocked beside the strict form",
      `${mock("{ useMutation: getTestMutation }")}\nvi.mocked(useMutation);`,
    ],
  ])("flags %s", (_, source) => {
    expect(bypassesRegistry("src/a.test.tsx", source)).toBe(true);
  });

  it("flags a test helper that builds a mutation mock", () => {
    expect(
      bypassesRegistry(
        "tests/fixtures/convexMock.ts",
        "export const convexMock = () => ({ useMutation: () => vi.fn() });",
      ),
    ).toBe(true);
  });

  it.each([
    ["the strict form", mock("{ useMutation: getTestMutation, useQuery }")],
    ["a mock without mutations", mock("{ useQuery: () => undefined }")],
    [
      "a comment",
      `// useMutation comes from the global mock\n${mock("{ useQuery }")}`,
    ],
    ["no local convex mock", "renderHook(() => useMutation(ref));"],
  ])("accepts %s", (_, source) => {
    expect(bypassesRegistry("src/a.test.tsx", source)).toBe(false);
  });
});

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
