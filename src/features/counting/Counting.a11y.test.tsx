import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { CountPlanBuilder } from "./CountPlanBuilder";
import { HandheldCount } from "./HandheldCount";
import { OpeningStockWorkbench } from "./OpeningStockWorkbench";

const WAREHOUSE = "prv_wh_bangpoo";

async function expectAccessible(ui: React.ReactElement) {
  window.localStorage.clear();
  writeStoredWarehouse(WAREHOUSE);
  const { container } = renderWithIntl(ui, {
    environment: previewEnvironment,
  });
  expect(await axe(container)).toHaveNoViolations();
  window.localStorage.clear();
}

describe("counting workflow accessibility", () => {
  it("keeps the opening-stock approval journey accessible", async () => {
    await expectAccessible(<OpeningStockWorkbench />);
  });

  it("keeps the count-plan builder accessible", async () => {
    await expectAccessible(<CountPlanBuilder />);
  });

  it("keeps the handheld count queue accessible", async () => {
    await expectAccessible(<HandheldCount />);
  });
});
