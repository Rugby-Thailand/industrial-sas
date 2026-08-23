import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { resolveAppEnvironment } from "@/lib/environment";

import { SetupChecklist } from "./SetupChecklist";

const backendMissingEnvironment = resolveAppEnvironment({
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});

const identityMissingEnvironment = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
});

describe("SetupChecklist", () => {
  it("shows only ready confirmation when every dependency is configured", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: configuredEnvironment,
    });

    expect(
      screen.getByText("ตั้งค่าแบ็กเอนด์ Convex แล้ว"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ตั้งค่าผู้ให้บริการตัวตนแล้ว"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(container.textContent).not.toContain(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
    expect(container.textContent).not.toContain(".env.local");
    expect(container.textContent).not.toContain(
      "ไม่มีทางลัดสำหรับข้ามการยืนยันตัวตน",
    );
  });

  it("gives backend remediation without attaching identity remediation to its ready row", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: backendMissingEnvironment,
    });

    expect(
      screen.getByText("ยังไม่ได้ตั้งค่าแบ็กเอนด์ Convex"),
    ).toBeInTheDocument();
    expect(container.textContent).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(
      screen.getByText("ตั้งค่าผู้ให้บริการตัวตนแล้ว"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
  });

  it("gives identity remediation without attaching backend remediation to its ready row", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: identityMissingEnvironment,
    });

    expect(
      screen.getByText("ตั้งค่าแบ็กเอนด์ Convex แล้ว"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(
      screen.getByText("ยังไม่ได้ตั้งค่าผู้ให้บริการตัวตน"),
    ).toBeInTheDocument();
    expect(container.textContent).toContain(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
  });

  it("names and explains both dependencies when both are missing", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: unconfiguredEnvironment,
    });

    expect(
      screen.getByText("ยังไม่ได้ตั้งค่าแบ็กเอนด์ Convex"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ยังไม่ได้ตั้งค่าผู้ให้บริการตัวตน"),
    ).toBeInTheDocument();
    expect(container.textContent).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(container.textContent).toContain(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
    expect(container.textContent).toContain(
      "คัดลอก .env.example ไปเป็น .env.local",
    );
    expect(container.textContent).toContain(
      "ไม่มีทางลัดสำหรับข้ามการยืนยันตัวตน",
    );
  });

  it("leaves the introduction to whichever screen mounted it", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: unconfiguredEnvironment,
    });

    expect(container.textContent).not.toContain(
      "แอปพลิเคชันนี้ต้องพึ่งบริการภายนอกที่ยังไม่ได้กำหนดค่าในเครื่องนี้",
    );
  });

  it("never renders configured secret values", () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: configuredEnvironment,
    });

    expect(container.textContent).not.toContain(
      configuredEnvironment.convexUrl,
    );
  });
});
