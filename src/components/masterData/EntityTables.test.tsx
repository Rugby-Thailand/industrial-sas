import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import {
  BarcodesTable,
  ItemUomsTable,
  LabelTemplatesTable,
  LotsTable,
  StorageClassesTable,
  SuppliersTable,
  conversionLabel,
} from "./EntityTables";

import {
  PREVIEW_LABEL_TEMPLATES,
  PREVIEW_STORAGE_CLASSES,
  PREVIEW_SUPPLIERS,
  previewBarcodesFor,
  previewItemUomsFor,
  previewLotsFor,
} from "@tests/fixtures/data/masterData";

const BOLT = "prv_item_bolt_m8";
const RESIN = "prv_item_resin_hd";

describe("SuppliersTable", () => {
  it("is a real table with a caption and column headers", () => {
    renderWithIntl(<SuppliersTable rows={PREVIEW_SUPPLIERS} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "รหัส" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(
      PREVIEW_SUPPLIERS.length + 1,
    );
  });

  it("renders Thai supplier names, which are the layout baseline", () => {
    renderWithIntl(<SuppliersTable rows={PREVIEW_SUPPLIERS} />);
    expect(screen.getByText("สยามสตีล อุตสาหกรรม")).toBeInTheDocument();
  });

  it("keeps the code English in both locales", () => {
    // `D-06`: a code identifier is the string a buyer searches for and a log
    // line quotes. Translating it would break both.
    const thai = renderWithIntl(<SuppliersTable rows={PREVIEW_SUPPLIERS} />);
    expect(thai.getByText("SIAM-STEEL")).toBeInTheDocument();
    thai.unmount();

    const english = renderWithIntl(
      <SuppliersTable rows={PREVIEW_SUPPLIERS} />,
      {
        locale: "en",
      },
    );
    expect(english.getByText("SIAM-STEEL")).toBeInTheDocument();
  });

  it("shows a deactivated supplier rather than hiding it", () => {
    // "No longer bought from" and "never existed" are different facts, and a
    // buyer looking for a missing supplier needs to tell them apart.
    renderWithIntl(<SuppliersTable rows={PREVIEW_SUPPLIERS} />);
    expect(screen.getByText("เลิกใช้")).toBeInTheDocument();
  });

  it("adds a control column only when the screen has controls", () => {
    const without = renderWithIntl(<SuppliersTable rows={PREVIEW_SUPPLIERS} />);
    expect(
      without.queryByRole("columnheader", { name: "การจัดการ" }),
    ).not.toBeInTheDocument();
    without.unmount();

    const withAction = renderWithIntl(
      <SuppliersTable
        rows={PREVIEW_SUPPLIERS}
        renderAction={(row) => <button type="button">{row.code}</button>}
      />,
    );
    expect(
      withAction.getByRole("columnheader", { name: "การจัดการ" }),
    ).toBeInTheDocument();
    expect(withAction.getAllByRole("button")).toHaveLength(
      PREVIEW_SUPPLIERS.length,
    );
  });
});

describe("StorageClassesTable", () => {
  it("lists every class with its status in words", () => {
    renderWithIntl(<StorageClassesTable rows={PREVIEW_STORAGE_CLASSES} />);

    expect(screen.getByText("วัตถุไวไฟ")).toBeInTheDocument();
    expect(screen.getAllByText("ใช้งาน").length).toBe(
      PREVIEW_STORAGE_CLASSES.length,
    );
  });
});

describe("BarcodesTable", () => {
  it("shows the padded GTIN exactly as the server stores it", () => {
    // 14 digits with the leading zero: the stored value is what a scan is
    // normalized to, and trimming it for display would teach the wrong string.
    renderWithIntl(<BarcodesTable rows={previewBarcodesFor(BOLT)} />);
    expect(screen.getByText("00614141000036")).toBeInTheDocument();
  });

  it("names each kind in words rather than by colour", () => {
    renderWithIntl(<BarcodesTable rows={previewBarcodesFor(BOLT)} />);
    expect(screen.getByText("GTIN สากล")).toBeInTheDocument();
    expect(screen.getByText("รหัสผู้จัดจำหน่าย")).toBeInTheDocument();
  });

  it("shows a deactivated alias, because the value is still printed on cartons", () => {
    renderWithIntl(<BarcodesTable rows={previewBarcodesFor(BOLT)} />);
    expect(screen.getByText("OLD-B8")).toBeInTheDocument();
    expect(screen.getByText("เลิกใช้")).toBeInTheDocument();
  });
});

describe("ItemUomsTable", () => {
  it("renders a whole-number factor without a denominator", () => {
    renderWithIntl(
      <ItemUomsTable rows={previewItemUomsFor(BOLT)} baseUom="EA" />,
    );

    expect(screen.getByText("CASE")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    // `12/1` reads as a defect, so the denominator is dropped when it is one.
    expect(screen.queryByText("12/1")).not.toBeInTheDocument();
  });

  it("renders a fraction that no decimal represents", () => {
    /*
     * The property the whole two-integer schema exists for. `200/3` litres per
     * third-drum has no decimal expansion, and rounding it for display would put
     * a number on screen that the ledger will never agree with.
     */
    renderWithIntl(
      <ItemUomsTable rows={previewItemUomsFor(RESIN)} baseUom="L" />,
    );
    expect(screen.getByText("200/3")).toBeInTheDocument();
  });

  it("names the base unit in the caption, so a bare factor is readable", () => {
    renderWithIntl(
      <ItemUomsTable rows={previewItemUomsFor(BOLT)} baseUom="EA" />,
    );
    expect(screen.getByText(/หน่วยหลัก EA/)).toBeInTheDocument();
  });

  it("formats a factor the same way wherever it is shown", () => {
    expect(
      conversionLabel({
        itemUomId: "x",
        itemId: "y",
        uom: "CASE",
        toBaseNumerator: 12,
        toBaseDenominator: 1,
        status: "ACTIVE",
      }),
    ).toBe("12");
    expect(
      conversionLabel({
        itemUomId: "x",
        itemId: "y",
        uom: "THIRD",
        toBaseNumerator: 200,
        toBaseDenominator: 3,
        status: "ACTIVE",
      }),
    ).toBe("200/3");
  });
});

describe("LotsTable", () => {
  it("shows a missing date as unrenderable rather than as blank", () => {
    // A blank cell reads as "no expiry" and as "we do not know" at the same
    // time. The placeholder means only the second.
    renderWithIntl(<LotsTable rows={previewLotsFor(BOLT)} />);
    expect(screen.getByText("——")).toBeInTheDocument();
  });

  it("shows a business date verbatim, not through a locale formatter", () => {
    /*
     * The stored value is a business date in the warehouse's timezone
     * (`ADR-0011`). Re-formatting it through the browser's locale could show a
     * different day than the one the ledger posted against.
     */
    renderWithIntl(<LotsTable rows={previewLotsFor(RESIN)} />);
    expect(screen.getByText("2026-09-02")).toBeInTheDocument();
  });
});

describe("LabelTemplatesTable", () => {
  it("distinguishes draft, active, and retired in words", () => {
    renderWithIntl(<LabelTemplatesTable rows={PREVIEW_LABEL_TEMPLATES} />);

    expect(screen.getByText("ฉบับร่าง")).toBeInTheDocument();
    expect(screen.getByText("ใช้งานอยู่")).toBeInTheDocument();
    expect(screen.getByText("เลิกใช้แล้ว")).toBeInTheDocument();
  });

  it("shows the version, because a printed label cites the one that produced it", () => {
    renderWithIntl(<LabelTemplatesTable rows={PREVIEW_LABEL_TEMPLATES} />);
    expect(
      screen.getByRole("columnheader", { name: "รุ่น" }),
    ).toBeInTheDocument();
  });

  it("offers a control only where the caller supplies one", () => {
    // Publishing is offered on drafts alone; the panel decides that, and the
    // table renders whatever it is handed — including nothing.
    renderWithIntl(
      <LabelTemplatesTable
        rows={PREVIEW_LABEL_TEMPLATES}
        renderAction={(row) =>
          row.status === "DRAFT" ? <button type="button">publish</button> : null
        }
      />,
    );
    expect(screen.getAllByRole("button", { name: "publish" })).toHaveLength(1);
  });
});
