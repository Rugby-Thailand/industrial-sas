import { relative, sep } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Slow files measured from hosted Planner quality run 45940179547 (JUnit).
// Weights affect assignment only. Every discovered file gets one shard, and
// new or renamed tests participate without a timings entry.
const secondsByFile: Readonly<Record<string, number>> = {
  "src/components/shell/DesktopShell.navigation.test.tsx": 6,
  "src/components/shell/DesktopShell.test.tsx": 6,
  "src/components/shell/search/GlobalSearch.test.tsx": 17,
  "src/components/storageLayouts/FloorMap.labels.test.tsx": 5,
  "src/components/storageLayouts/FloorMap.workspace.test.tsx": 6,
  "src/features/customers/CustomerScreens.test.tsx": 12,
  "src/features/finishedGoods/BatchManager.test.tsx": 6,
  "src/features/finishedGoods/PackingScreen.test.tsx": 30,
  "src/features/finishedGoods/PalletScreens.test.tsx": 7,
  "src/features/finishedGoods/ProductScreens.test.tsx": 10,
  "src/features/finishedGoods/jobScan/JobScanRecords.test.tsx": 11,
  "src/features/finishedGoods/jobScan/JobScanRecordsTools.test.tsx": 7,
  "src/features/finishedGoods/jobScan/JobScanScreen.capacity.test.tsx": 22,
  "src/features/finishedGoods/jobScan/JobScanScreen.retention.test.tsx": 13,
  "src/features/finishedGoods/jobScan/JobScanScreen.test.tsx": 8,
  "src/features/finishedGoods/jobScan/LocationPicker.ai.test.tsx": 6,
  "src/features/hr/EmployeeProfileSections.test.tsx": 15,
  "src/features/hr/HrOrgSettings.test.tsx": 7,
  "src/features/storageLayouts/StorageLayoutNavigation.test.tsx": 11,
  "src/features/storageLayouts/StorageLayoutScreens.test.tsx": 14,
  "tests/integration/catalogue-search-budget.integration.test.ts": 18,
  "tests/integration/ci-codegen-isolation.integration.test.ts": 8,
  "tests/integration/hr-payslip-payloads.integration.test.ts": 29,
  "tests/integration/job-scan-ai-and-search.integration.test.ts": 8,
  "tests/integration/job-scan-search-index.integration.test.ts": 54,
  "tests/integration/location-search-index.integration.test.ts": 10,
  "tests/integration/search-index-write-costs.integration.test.ts": 18,
  "tests/integration/storage-query-scale.integration.test.ts": 9,
};

export class TimingBalancedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const { root, shard } = this.ctx.config;
    if (!shard) return files;

    const weighted = files.map((file) => {
      const path = relative(root, file.moduleId).split(sep).join("/");
      return {
        file,
        key: `${file.project.name}:${path}`,
        weight: secondsByFile[path] ?? 1,
      };
    });
    weighted.sort(
      (a, b) =>
        b.weight - a.weight || (a.key < b.key ? -1 : Number(a.key > b.key)),
    );

    const shards = Array.from({ length: shard.count }, () => ({
      weight: 0,
      files: [] as TestSpecification[],
    }));
    for (const { file, weight } of weighted) {
      const lightest = shards.reduce((a, b) => (a.weight <= b.weight ? a : b));
      lightest.files.push(file);
      lightest.weight += weight;
    }
    return shards[shard.index - 1]!.files;
  }
}
