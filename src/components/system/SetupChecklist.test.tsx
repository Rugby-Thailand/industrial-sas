import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { SetupChecklist } from "./SetupChecklist";

describe("SetupChecklist", () => {
  it("names each missing dependency separately", () => {
    renderWithIntl(<SetupChecklist />, {
      environment: unconfiguredEnvironment,
    });

    expect(
      screen.getByText("ยังไม่ได้ตั้งค่าแบ็กเอนด์ Convex"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ยังไม่ได้ตั้งค่าผู้ให้บริการตัวตน"),
    ).toBeInTheDocument();
  });

  it("reports a configured dependency as ready", () => {
    renderWithIntl(<SetupChecklist />, { environment: configuredEnvironment });

    expect(
      screen.getByText("ตั้งค่าแบ็กเอนด์ Convex แล้ว"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ตั้งค่าผู้ให้บริการตัวตนแล้ว"),
    ).toBeInTheDocument();
  });

  it("states that there is no sign-in bypass", () => {
    /*
     * The reader of this screen is exactly the person about to look for a
     * development shortcut past authentication. Saying plainly that none exists
     * is cheaper than them finding a way to add one.
     */
    renderWithIntl(<SetupChecklist />, {
      environment: unconfiguredEnvironment,
    });

    expect(
      screen.getByText(/ไม่มีทางลัดสำหรับข้ามการยืนยันตัวตน/),
    ).toBeInTheDocument();
  });

  it("names no secret value, only variable names", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: configuredEnvironment,
    });

    expect(container.textContent).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(container.textContent).not.toContain(
      configuredEnvironment.convexUrl,
    );
  });
});
