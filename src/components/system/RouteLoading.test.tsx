import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { RouteLoading } from "./RouteLoading";

describe("RouteLoading", () => {
  it("announces page loading without exposing decorative placeholders", () => {
    renderWithIntl(<RouteLoading />, {
      environment: unconfiguredEnvironment,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("กำลังโหลดหน้า…");
    expect(status.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(10);
  });
});
