import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";

import { DeviceRegistryPanel } from "./DeviceRegistryPanel";

describe("device registry panel", () => {
  it("supports registration and binding without exposing installation IDs", () => {
    renderWithIntl(<DeviceRegistryPanel />, {
      environment: previewEnvironment,
    });

    expect(screen.getByTestId("form-device-register")).toBeInTheDocument();
    expect(screen.getByLabelText("ป้ายทรัพย์สิน")).toBeInTheDocument();
    expect(screen.getByLabelText("ประเภทอุปกรณ์")).toBeInTheDocument();
    expect(screen.getByLabelText("ผูกการติดตั้งแอปนี้")).toBeInTheDocument();
    expect(screen.getByTestId("device-bind-prv_device_2")).toBeInTheDocument();
    expect(
      screen.queryByTestId("device-bind-prv_device_1"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("เลิกใช้แล้ว")).toHaveLength(2);
    expect(screen.queryByText(/^install_/)).not.toBeInTheDocument();
  });
});
