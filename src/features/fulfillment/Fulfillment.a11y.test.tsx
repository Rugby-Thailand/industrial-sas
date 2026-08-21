import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { FulfillmentBoard } from "./FulfillmentBoard";
import { FulfillmentExecutionBoard } from "./FulfillmentExecutionBoard";
import { HandheldDelivery } from "./HandheldDelivery";
import { HandheldLoad } from "./HandheldLoad";
import { HandheldPick } from "./HandheldPick";
import { PodReviewQueue } from "./PodReviewQueue";
import { TransportBoard } from "./TransportBoard";

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

describe("Path A fulfillment accessibility", () => {
  it("keeps allocation and warehouse execution accessible", async () => {
    await expectAccessible(
      <>
        <FulfillmentBoard />
        <FulfillmentExecutionBoard />
      </>,
    );
  });

  it("keeps trip planning and POD review accessible", async () => {
    await expectAccessible(
      <>
        <TransportBoard />
        <PodReviewQueue />
      </>,
    );
  });

  it("keeps picker, loader, and driver handheld surfaces accessible", async () => {
    await expectAccessible(
      <>
        <HandheldPick />
        <HandheldLoad />
        <HandheldDelivery />
      </>,
    );
  });
});
