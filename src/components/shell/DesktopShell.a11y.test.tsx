import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import {
  navigationMock,
  setMockPathname,
} from "../../../tests/fixtures/navigation-mock";
import {
  testEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { DesktopShell } from "./DesktopShell";

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
      { environment: testEnvironment },
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
