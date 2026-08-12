import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  navigationMock,
  resetRouterCalls,
  routerReplaceCalls,
  setMockPathname,
} from "../../../tests/fixtures/navigation-mock";
import {
  previewEnvironment,
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

/**
 * The two selects that live in the shell chrome, in both languages.
 *
 * These are the controls the migration was actually about. The warehouse
 * chooser on `/th/dashboard` was a native `<select>`, so its popup was drawn by
 * the operating system in the operating system's colours — a white list on a
 * dark screen, which no page style could reach. Everything asserted below is
 * behaviour rather than appearance, because appearance is what the Playwright
 * screenshot suite is for; what these prove is that the behaviour the native
 * control gave away for free is still there.
 */
describe("the warehouse selector", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("offers the tenant's warehouses in Thai", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: previewEnvironment,
      locale: "th",
    });

    expect(selectOptionLabels("คลังสินค้า")).toEqual([
      "BPU · คลังบางปู",
      "LPN · คลังลำพูน",
    ]);
  });

  it("offers the same warehouses in English", () => {
    /*
     * The same rows, the same IDs, the other language. The label is data on the
     * warehouse (`B-10`) rather than a translation key, so this is the check
     * that the *catalogue* and the *record* stay in step.
     */
    renderWithIntl(<WorkspaceContextBar />, {
      environment: previewEnvironment,
      locale: "en",
    });

    expect(selectOptionLabels("Warehouse")).toEqual([
      "BPU · Bang Pu plant store",
      "LPN · Lamphun finished goods",
    ]);
  });

  it("stores the chosen warehouse so every scoped read agrees with it", () => {
    // The selection is the argument the server revalidates on every call
    // (`INV-0006-04`), so choosing has to survive the render that follows it.
    renderWithIntl(<WorkspaceContextBar />, {
      environment: previewEnvironment,
      locale: "th",
    });

    chooseOption("คลังสินค้า", "LPN · คลังลำพูน");

    expect(readStoredWarehouse()).toBe("prv_wh_lamphun");
    expect(selectedLabel("คลังสินค้า")).toContain("คลังลำพูน");
  });

  it("asks for a choice rather than picking one when several sites exist", () => {
    renderWithIntl(<WorkspaceContextBar />, {
      environment: previewEnvironment,
      locale: "th",
    });

    expect(selectTrigger("คลังสินค้า")).toHaveTextContent("เลือกคลังสินค้า");
  });

  it("renders the reason instead of an empty menu when there is no organization", () => {
    /*
     * Without an identity provider there is no verified organization claim and
     * therefore no warehouse list. An empty dropdown would read as "this tenant
     * has no sites"; the sentence says "not available yet".
     */
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
    /*
     * The one behaviour this control has. `usePathname` here is locale-free, so
     * replacing it with the other locale lands on *this* screen in English —
     * and `replace` rather than `push` keeps the back button meaning "the
     * previous screen" instead of "this screen in the other language".
     */
    renderWithIntl(<LocaleSwitcher />, { locale: "th" });

    chooseOption("ภาษา", "อังกฤษ");

    expect(routerReplaceCalls).toEqual([
      { href: "/inventory/balances", locale: "en" },
    ]);
  });

  it("offers exactly the two languages the application ships", () => {
    // Two options stay a menu. Turning a two-item chooser into a search field
    // would be a worse control, which is why this one is not an autocomplete.
    renderWithIntl(<LocaleSwitcher />, { locale: "th" });

    expect(selectOptionLabels("ภาษา")).toEqual(["ไทย", "อังกฤษ"]);
  });

  it("shows the active language rather than a placeholder", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "en" });
    expect(selectedLabel("Language")).toContain("English");
  });
});
