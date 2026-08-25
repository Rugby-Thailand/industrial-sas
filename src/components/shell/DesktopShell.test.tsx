import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  navigationMock,
  setMockPathname,
} from "../../../tests/fixtures/navigation-mock";
import {
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

vi.mock("@/i18n/navigation", () => navigationMock);

import { DesktopShell } from "./DesktopShell";
import { NAVIGATION_PERMISSION_CODES } from "../../../convex/model/authorization/navigationPermissions";
import * as WorkspaceModule from "@/components/providers/WorkspaceProvider";

describe("DesktopShell", () => {
  beforeEach(() => {
    setMockPathname("/dashboard");
    vi.spyOn(WorkspaceModule, "useWorkspace").mockReturnValue({
      organization: { id: "org_1", name: "Siam" },
      warehouses: [],
      selectedWarehouseId: undefined,
      selectable: false,
      complete: true,
      loading: false,
      denied: false,
      navigationPermissions: NAVIGATION_PERMISSION_CODES,
      permissionsReady: true,
      selectWarehouse: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders exactly one navigation landmark", () => {
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
    expect(screen.getByRole("navigation").parentElement).toHaveClass("w-56");
    expect(screen.queryByText("Industrial SAS")).not.toBeInTheDocument();
    expect(
      screen.queryByText("ระบบจัดการคลังสินค้าสำหรับผู้ผลิตในประเทศไทย"),
    ).not.toBeInTheDocument();
  });

  it("collapses the desktop rail to labelled icon buttons", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    const navigation = screen.getByRole("navigation");
    expect(navigation.parentElement).toHaveClass("w-56");

    const collapse = screen.getByRole("button", { name: "ย่อแถบนำทาง" });
    expect(collapse.querySelector("svg.lucide-chevrons-left")).toHaveClass(
      "size-5",
    );

    await user.click(collapse);

    const expand = screen.getByRole("button", { name: "ขยายแถบนำทาง" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand.querySelector("svg.lucide-chevrons-right")).toHaveClass(
      "size-5",
    );
    expect(navigation.parentElement).toHaveClass("w-16");

    const dashboard = screen.getByRole("link", { name: "แดชบอร์ด" });
    expect(dashboard.querySelector("span")).toHaveClass("sr-only");
    await user.hover(dashboard);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("แดชบอร์ด");
  });

  it("does not add development banners to the application shell", () => {
    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    expect(screen.queryByTestId("preview-banner")).toBeNull();
  });

  it("shows only destinations granted by the workspace capability snapshot", () => {
    vi.spyOn(WorkspaceModule, "useWorkspace").mockReturnValue({
      organization: { id: "org_1", name: "Siam" },
      warehouses: [],
      selectedWarehouseId: undefined,
      selectable: false,
      complete: true,
      loading: false,
      denied: false,
      navigationPermissions: [
        "production.order.read",
        "masterData.item.read",
        "masterData.location.read",
      ],
      permissionsReady: true,
      selectWarehouse: vi.fn(),
    });

    renderWithIntl(<DesktopShell>content</DesktopShell>, {
      environment: unconfiguredEnvironment,
    });

    expect(
      screen.getByRole("link", { name: "ดำเนินงานผลิต" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "ผู้จัดจำหน่าย" }),
    ).not.toBeInTheDocument();
  });
});
