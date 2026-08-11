import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  previewEnvironment,
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
      { environment: previewEnvironment },
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives every interactive control the glove-compatible minimum size", () => {
    /*
     * `INV-0010-06` is 48×48 CSS pixels. jsdom computes no layout, so the
     * assertion is on the token that produces the size — `min-h-touch`, which
     * resolves to the 3rem spacing token — rather than on a measured box. The
     * physical check is a manual acceptance item (`RG-042`); this catches the
     * control that was written without the class at all.
     */
    renderWithIntl(
      <HandheldShell>
        <p>เนื้อหา</p>
      </HandheldShell>,
      { environment: previewEnvironment },
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
