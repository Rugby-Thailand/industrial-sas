import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { OwnerAttentionListView } from "./OwnerAttentionList";

describe("OwnerAttentionListView", () => {
  it("shows the highest owner-impact exceptions with their truthful source links", () => {
    renderWithIntl(
      <OwnerAttentionListView
        payload={{
          ok: true,
          asOf: 1_776_000_000_000,
          complete: false,
          exceptions: [
            {
              sourceType: "QC",
              sourceId: "qc_1",
              severity: "CRITICAL",
              titleCode: "QC_HOLD",
              detail: "Batch FG-104 needs a disposition before shipment.",
              occurredAt: 1_776_000_000_000,
              deepLink: "/quality",
            },
          ],
        }}
      />,
      { locale: "en" },
    );

    expect(
      screen.getByText("Finished goods awaiting quality decision"),
    ).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open source workflow" }),
    ).toHaveAttribute("href", "/quality");
    expect(screen.getByText(/This list is partial/)).toBeInTheDocument();
  });
});
