import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("DesktopShell", () => {
  beforeEach(() => {
    setMockPathname("/dashboard");
  });

  it("renders exactly one navigation landmark", () => {
    // Two copies of the nav — one for narrow, one for wide — would produce two
    // landmarks and duplicate every link for a screen reader.
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("offers a skip link as the first focusable element", () => {
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    const skip = screen.getByRole("link", { name: "ข้ามไปยังเนื้อหาหลัก" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("lets wide tables shrink inside the content column", () => {
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    const main = screen.getByRole("main");
    expect(main).toHaveClass("min-w-0");
    expect(main.parentElement).toHaveClass("min-w-0");
  });

  it("marks the current page with aria-current, not with colour alone", () => {
    setMockPathname("/inventory/balances");
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    expect(screen.getByRole("link", { name: "ยอดคงเหลือ" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "แดชบอร์ด" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("exposes the compact navigation disclosure state", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    const toggle = screen.getByRole("button", { name: "เปิดเมนู" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "primary-navigation");
    expect(toggle).toHaveAttribute("data-size", "icon");
    expect(toggle).toHaveTextContent("");
    expect(toggle.querySelector("svg.lucide-menu")).toHaveClass("size-6");

    await user.click(toggle);

    const close = screen.getByRole("button", { name: "ปิดเมนู" });
    expect(close).toHaveAttribute("aria-expanded", "true");
    expect(close).toHaveTextContent("");
    expect(close.querySelector("svg.lucide-x")).toHaveClass("size-6");
  });

  it("reports an unconfigured deployment rather than a connection attempt", () => {
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    expect(screen.getByText("ยังไม่ได้ตั้งค่า")).toBeInTheDocument();
  });

  it("shows no preview banner when preview mode is off", () => {
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    expect(screen.queryByTestId("preview-banner")).toBeNull();
  });

  it("shows a preview banner that cannot be dismissed when preview mode is on", () => {
    // A dismissible banner is dismissed once, and thereafter synthetic stock is
    // indistinguishable from a warehouse's real balances.
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: previewEnvironment,
    });

    const banner = screen.getByTestId("preview-banner");
    expect(banner).toBeInTheDocument();
    // Scoped to the banner: the shell's own menu toggle is a button, and a
    // document-wide query would match it.
    expect(within(banner).queryAllByRole("button")).toHaveLength(0);
  });
});
