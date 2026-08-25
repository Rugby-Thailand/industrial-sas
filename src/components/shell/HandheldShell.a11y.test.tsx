import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { HandheldShell } from "./HandheldShell";

describe("HandheldShell accessibility", () => {
  it("has no detectable axe violations", async () => {
    const { container } = renderWithIntl(
      <HandheldShell>
        <h1>ค้นหาสต็อก</h1>
      </HandheldShell>,
      { environment: testEnvironment },
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives every interactive control the glove-compatible minimum size", () => {
    renderWithIntl(
      <HandheldShell>
        <p>เนื้อหา</p>
      </HandheldShell>,
      { environment: testEnvironment },
    );

    const controls = [
      ...screen.getAllByRole("link"),
      ...screen.getAllByRole("combobox"),
    ].filter((element) => !element.className.includes("sr-only"));

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.className, control.textContent ?? "").toContain(
        "min-h-touch",
      );
    }
  });
});
