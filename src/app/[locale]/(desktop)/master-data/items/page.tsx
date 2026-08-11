import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { ItemForm } from "@/features/masterData/CoreForms";
import { PanelSection } from "@/features/masterData/EntityPanels";
import { ItemsPanel } from "@/features/masterData/ItemsPanel";

/**
 * The item register, backed by `masterData/catalogue:listItems` and
 * `masterData/writes:createItem`.
 *
 * Each row links to its own maintenance screen rather than expanding in place.
 * Barcodes, alternate units, and lots all hang off one item, and three
 * sub-tables inside a row would be a page inside a cell.
 */
export default async function ItemsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <>
      <PageHeader title={t("itemsTitle")} description={t("itemsDescription")} />
      <div className="mb-4">
        <Notice tone="muted" title={t("maintainNotice")} />
      </div>
      <PanelSection title={t("sectionRegister")}>
        <ItemsPanel />
      </PanelSection>
      <PanelSection title={t("sectionAdd")}>
        <ItemForm />
      </PanelSection>
    </>
  );
}
