import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import { InboundOperationsBoard } from "./InboundOperationsBoard";

const BANG_PU = "prv_wh_bangpoo";

const renderBoard = (locale: "th" | "en" = "th") =>
  renderWithIntl(
    <WorkspaceProvider>
      <InboundOperationsBoard />
    </WorkspaceProvider>,
    { locale, environment: testEnvironment },
  );

beforeEach(() => writeStoredWarehouse(BANG_PU));
afterEach(() => window.localStorage.clear());

describe("InboundOperationsBoard", () => {
  it("places the post-PO queues in operational order", () => {
    renderBoard("en");

    expect(
      screen.getByRole("region", { name: "Inbound workflow board" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "1. Purchase orders",
      "2. Receiving",
      "3. Quality",
      "4. Putaway",
    ]);
  });

  it("opens cards in the workflow that owns the next transition", () => {
    renderBoard("en");

    expect(screen.getByRole("link", { name: "Open PO-2601" })).toHaveAttribute(
      "href",
      "/purchasing/orders/prv_po_2601",
    );
    expect(screen.getByRole("link", { name: "Open GRN-5001" })).toHaveAttribute(
      "href",
      "/receiving/prv_rcpt_5001",
    );
    expect(
      screen.getAllByRole("link", { name: /^Open Inspection/ })[0],
    ).toHaveAttribute("href", "/quality");
    expect(
      screen.getAllByRole("link", { name: /^Open Putaway/ })[0],
    ).toHaveAttribute("href", "/putaway");
  });

  it.each(["th", "en"] as const)(
    "has no detectable accessibility violations in %s",
    async (locale) => {
      const { container } = renderBoard(locale);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
