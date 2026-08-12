import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  previewEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { SuppliersPanel } from "./EntityPanels";

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

/**
 * The pager `MasterDataPanel` renders, in the language an operator reads it in.
 *
 * The ledger side of this is covered by `BalancesPanel.test.tsx`; this is the
 * master-data side, and it exists because the two panels reach the same five
 * strings through separate `useTranslations` calls. A namespace that is wrong in
 * only one of them renders `Pagination.nextPage` onto a warehouse screen — and
 * `clientMessages.test.ts`, which reads the source graph rather than the output,
 * would still pass, because the manifest would simply follow the mistake.
 *
 * Suppliers is the subject because the list is organization-scoped, so the pager
 * renders without a warehouse having to be chosen first.
 */
const renderPanel = (environment: Parameters<typeof renderWithIntl>[1]) =>
  renderWithIntl(
    <WorkspaceProvider>
      <SuppliersPanel />
    </WorkspaceProvider>,
    environment,
  );

afterEach(() => {
  window.localStorage.clear();
});

describe("MasterDataPanel paging chrome", () => {
  it("names the pager and its controls in Thai", () => {
    renderPanel({ environment: previewEnvironment });

    // By accessible name, because that is the thing a key path would break: a
    // missing message renders as `Pagination.previousPage`, which still matches
    // a text query for the surrounding markup but never matches this.
    expect(
      screen.getByRole("navigation", { name: "การแบ่งหน้า" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "หน้าก่อนหน้า" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "หน้าถัดไป" }),
    ).toBeInTheDocument();
  });

  it("says the rows are complete when a page is the whole list", () => {
    // The preview supplier list is shorter than a page, so the panel reports the
    // end of the data rather than a page number. Both branches read from the
    // same namespace; this is the one an operator sees on most master data.
    renderPanel({ environment: previewEnvironment });

    expect(screen.getByText("แสดงครบทุกรายการแล้ว")).toBeInTheDocument();
  });

  it("renders no pager at all before the read is possible", () => {
    // The gate runs first, so an unconfigured deployment shows the reason and
    // nothing else — including none of the chrome above.
    renderPanel({ environment: unconfiguredEnvironment });

    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
