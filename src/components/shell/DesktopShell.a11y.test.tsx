import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import {
  navigationMock,
  setMockPathname,
} from "../../../tests/fixtures/navigation-mock";
import {
  previewEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { DesktopShell } from "./DesktopShell";

/**
 * `INV-0010-09`: zero axe violations for every shipped screen.
 *
 * Rendered with the Thai catalogue, which is the layout baseline (`ADR-0010`
 * §5) — Latin placeholder text hides Thai line-height and wrapping defects, and
 * axe checks that depend on text (name, contrast of text nodes) should see the
 * strings an operator sees.
 */
describe("DesktopShell accessibility", () => {
  it("has no detectable violations in its default state", async () => {
    setMockPathname("/dashboard");
    const { container } = renderWithIntl(
      <DesktopShell>
        <h1>เนื้อหา</h1>
      </DesktopShell>,
      { environment: unconfiguredEnvironment },
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no detectable violations with the preview banner present", async () => {
    setMockPathname("/inventory/balances");
    const { container } = renderWithIntl(
      <DesktopShell>
        <h1>เนื้อหา</h1>
      </DesktopShell>,
      { environment: previewEnvironment },
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
