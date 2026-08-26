"use client";

import { useTranslations } from "next-intl";

import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import { createCustomerOrderRef } from "@/lib/convex/orderToShipApi";

export function OrderIntakeForm({
  onSaved,
}: {
  readonly onSaved?: () => void;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <EntityWriteForm
      presentation="inline"
      mutationRef={createCustomerOrderRef}
      legend={t("newOrder")}
      description={t("newOrderDetail")}
      submitLabel={t("saveOrder")}
      requiredMessage={t("requiredField")}
      testId="customer-order-form"
      {...(onSaved === undefined ? {} : { onSaved })}
      fields={[
        {
          name: "orderNumber",
          label: t("orderNumber"),
          kind: "text",
          required: true,
          monospace: true,
        },
        {
          name: "customerId",
          label: t("customerId"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("customerIdHint"),
        },
        {
          name: "customerReference",
          label: t("customerPo"),
          kind: "text",

          importance: "secondary",
          monospace: true,
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        orderNumber: values.orderNumber ?? "",
        customerId: values.customerId ?? "",
        ...((values.customerReference ?? "") === ""
          ? {}
          : { customerReference: values.customerReference }),
      })}
    />
  );
}
