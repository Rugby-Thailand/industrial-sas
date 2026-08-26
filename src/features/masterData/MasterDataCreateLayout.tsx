import type { ReactNode } from "react";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";

import { WriteDialog } from "./WriteDialog";

export function MasterDataCreateLayout({
  title,
  description,
  notice,
  registerTitle,
  createLabel,
  closeLabel,
  register,
  form,
}: {
  readonly title: string;
  readonly description: string;
  readonly notice: string;
  readonly registerTitle: string;
  readonly createLabel: string;
  readonly closeLabel: string;
  readonly register: ReactNode;
  readonly form: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title={title} description={description} />
        <WriteDialog
          triggerLabel={createLabel}
          title={createLabel}
          closeLabel={closeLabel}
        >
          {form}
        </WriteDialog>
      </div>

      <div className="mb-6">
        <Notice tone="muted" title={notice} />
      </div>

      <section className="mb-8 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-text">{registerTitle}</h2>
        {register}
      </section>
    </>
  );
}
