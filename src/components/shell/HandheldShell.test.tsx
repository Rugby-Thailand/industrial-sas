import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { HandheldShell } from "./HandheldShell";

/**
 * The handheld shell is a *handheld* shell wherever it is opened.
 *
 * On a 1280px desktop the same markup stretched a one-task screen across the
 * whole window — a single field with a metre of empty space beside it. jsdom
 * lays nothing out, so what is asserted is the constraint that produces the
 * shape: a bounded, centred column. The cap is above every phone width this
 * application targets, so a 360px viewport is unaffected.
 */
describe("HandheldShell layout", () => {
  const render = () =>
    renderWithIntl(
      <HandheldShell>
        <p>เนื้อหา</p>
      </HandheldShell>,
      { environment: previewEnvironment },
    );

  it("bounds and centres the workspace instead of filling a desktop window", () => {
    render();

    const workspace = screen.getByTestId("handheld-workspace");
    expect(workspace).toHaveClass("mx-auto", "max-w-md", "w-full");
  });

  it("keeps the column full-height and full-width on a narrow screen", () => {
    // `max-w-md` is 448 CSS pixels and `w-full` is what makes a 360px viewport
    // fill the column, so nothing here narrows a scanner's screen.
    render();

    const workspace = screen.getByTestId("handheld-workspace");
    expect(workspace).toHaveClass("min-h-dvh", "flex", "flex-col");
  });

  it("lets the compact header wrap instead of widening a phone viewport", () => {
    render();

    const headerRow = screen
      .getByTestId("locale-select")
      .closest("header")
      ?.querySelector(":scope > div");
    expect(headerRow).toHaveClass("flex-wrap");
  });

  it("still contains the operator's task region", () => {
    render();

    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("เนื้อหา");
    expect(screen.getByTestId("handheld-workspace")).toContainElement(main);
  });
});
