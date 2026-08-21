import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { TransferBoard } from "./TransferBoard";

describe("transfer workflow accessibility", () => {
  it("keeps request, dispatch, and destination receipt accessible", async () => {
    window.localStorage.clear();
    writeStoredWarehouse("prv_wh_bangpoo");
    const { container } = renderWithIntl(<TransferBoard />, {
      environment: previewEnvironment,
    });
    expect(await axe(container)).toHaveNoViolations();
    window.localStorage.clear();
  });
});
