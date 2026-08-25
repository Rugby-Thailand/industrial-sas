import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  navigationMock,
  resetRouterCalls,
  routerReplaceCalls,
  setMockPathname,
} from "../../../tests/fixtures/navigation-mock";
import {
  testEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";
import {
  chooseOption,
  selectOptionLabels,
  selectTrigger,
  selectedLabel,
} from "../../../tests/fixtures/select-control";

vi.mock("@/i18n/navigation", () => navigationMock);

import { readStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { WorkspaceContextBar } from "./WorkspaceContextBar";

describe("the warehouse selector", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("offers the tenant's warehouses in Thai", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: testEnvironment,
      locale: "th",
    });

    expect(selectOptionLabels("คลังสินค้า")).toEqual([
      "BPU · คลังบางปู",
      "LPN · คลังลำพูน",
    ]);
  });

  it("keeps stored warehouse names stable when the interface is English", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: testEnvironment,
      locale: "en",
    });

    expect(selectOptionLabels("Warehouse")).toEqual([
      "BPU · คลังบางปู",
      "LPN · คลังลำพูน",
    ]);
  });

  it("stores the chosen warehouse so every scoped read agrees with it", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: testEnvironment,
      locale: "th",
    });

    chooseOption("คลังสินค้า", "LPN · คลังลำพูน");

    expect(readStoredWarehouse()).toBe("prv_wh_lamphun");
    expect(selectedLabel("คลังสินค้า")).toContain("คลังลำพูน");
  });

  it("asks for a choice rather than picking one when several sites exist", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: testEnvironment,
      locale: "th",
    });

    expect(selectTrigger("คลังสินค้า")).toHaveTextContent("เลือกคลังสินค้า");
  });

  it("renders the reason instead of an empty menu when there is no organization", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: unconfiguredEnvironment,
      locale: "th",
    });

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("ไม่มีบริบทองค์กร")).toBeInTheDocument();
  });
});

describe("the language selector", () => {
  beforeEach(() => {
    resetRouterCalls();
    setMockPathname("/inventory/balances");
  });

  it("replaces the current route in the other language rather than navigating away", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "th" });

    chooseOption("ภาษา", "อังกฤษ");

    expect(routerReplaceCalls).toEqual([
      { href: "/inventory/balances", locale: "en" },
    ]);
  });

  it("offers exactly the two languages the application ships", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "th" });

    expect(selectOptionLabels("ภาษา")).toEqual(["ไทย", "อังกฤษ"]);
  });

  it("shows the active language rather than a placeholder", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "en" });
    expect(selectedLabel("Language")).toContain("English");
  });
});
