import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { HandheldShell } from "./HandheldShell";

describe("HandheldShell layout", () => {
  const render = () =>
    renderWithIntl(
      <HandheldShell>
        <p>เนื้อหา</p>
      </HandheldShell>,
      { environment: testEnvironment },
    );

  it("bounds and centres the workspace instead of filling a desktop window", () => {
    render();

    const workspace = screen.getByTestId("handheld-workspace");
    expect(workspace).toHaveClass("mx-auto", "max-w-md", "w-full");
  });

  it("keeps the column full-height and full-width on a narrow screen", () => {
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
