import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";

import { EntityForm } from "./EntityForm";
import {
  BarcodesTable,
  ItemUomsTable,
  LabelTemplatesTable,
  LotsTable,
  StorageClassesTable,
  SuppliersTable,
} from "./EntityTables";
import { WriteOutcomeNotice } from "./WriteOutcomeNotice";

import { SupplierForm } from "@/features/masterData/EntityPanels";
import {
  PREVIEW_LABEL_TEMPLATES,
  PREVIEW_STORAGE_CLASSES,
  PREVIEW_SUPPLIERS,
  previewBarcodesFor,
  previewItemUomsFor,
  previewLotsFor,
} from "@/lib/preview/masterDataPreview";

/**
 * `INV-0010-09` for the Phase 2 maintenance screens.
 *
 * Both locales, because Thai and English differ in more than glyphs: the
 * accessible name of every header, label, badge, and caption comes from the
 * catalogue, and a name that is empty in one language is a violation only in
 * that language.
 *
 * The write states are checked too. A form is easy to keep accessible while it
 * is empty and easy to break the moment it grows an error message, an
 * `aria-invalid`, and a live region — which is exactly the state an operator
 * reaches it in.
 */
const BOLT = "prv_item_bolt_m8";
const LOCALES = ["th", "en"] as const;

/*
 * Thunks rather than elements: an array of JSX is an array React would want
 * keys for, and these are rendered one at a time rather than as a list.
 */
const cases = [
  ["SuppliersTable", () => <SuppliersTable rows={PREVIEW_SUPPLIERS} />],
  [
    "SuppliersTable with controls",
    () => (
      <SuppliersTable
        rows={PREVIEW_SUPPLIERS}
        renderAction={(row) => <button type="button">{row.code}</button>}
      />
    ),
  ],
  [
    "StorageClassesTable",
    () => <StorageClassesTable rows={PREVIEW_STORAGE_CLASSES} />,
  ],
  ["BarcodesTable", () => <BarcodesTable rows={previewBarcodesFor(BOLT)} />],
  [
    "ItemUomsTable",
    () => <ItemUomsTable rows={previewItemUomsFor(BOLT)} baseUom="EA" />,
  ],
  ["LotsTable", () => <LotsTable rows={previewLotsFor(BOLT)} />],
  [
    "LabelTemplatesTable",
    () => <LabelTemplatesTable rows={PREVIEW_LABEL_TEMPLATES} />,
  ],
] as const;

describe("Phase 2 master-data table accessibility", () => {
  for (const [name, render] of cases) {
    it.each(LOCALES)(
      `${name} has no detectable axe violations in %s`,
      async (locale) => {
        const { container } = renderWithIntl(render(), { locale });
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  }
});

describe("write control accessibility", () => {
  it.each(LOCALES)(
    "a form with an error and a blamed field is clean in %s",
    async (locale) => {
      const { container } = renderWithIntl(
        <EntityForm
          legend="เพิ่มรายการ"
          description="คำอธิบาย"
          fields={[
            {
              name: "code",
              label: "รหัส",
              kind: "text",
              required: true,
              hint: "ห้ามซ้ำ",
            },
            {
              name: "kind",
              label: "ชนิด",
              kind: "select",
              options: [{ value: "GTIN", label: "GTIN" }],
            },
            { name: "body", label: "เนื้อหา", kind: "textarea" },
          ]}
          submitLabel="บันทึก"
          requiredMessage="ต้องกรอกช่องนี้"
          busy={false}
          invalidField="code"
          outcome={
            <WriteOutcomeNotice
              state={{ kind: "REFUSED", code: "DUPLICATE_KEY", field: "code" }}
            />
          }
          onSubmit={() => undefined}
        />,
        { locale },
      );

      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(LOCALES)("a denied outcome is clean in %s", async (locale) => {
    const { container } = renderWithIntl(
      <WriteOutcomeNotice state={{ kind: "DENIED", requestId: "req_1" }} />,
      { locale },
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(LOCALES)(
    "the preview supplier form is clean in %s",
    async (locale) => {
      // The whole assembled screen control, translated, in the environment a
      // reviewer will actually open it in.
      const { container } = renderWithIntl(<SupplierForm />, {
        locale,
        environment: previewEnvironment,
      });
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
