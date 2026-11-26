"use client";

import { Copy, Mail, MapPin, Phone, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { Notice } from "@/components/ui/Notice";
import { CustomerDetailCard } from "./CustomerDetailCard";
import { mailtoHref, telHref } from "./contactLinks";
import type { CustomerDetailRow } from "./customerTypes";

const DASH = "—";

export function CustomerDelivery({
  customer,
  contactRef,
  showNotes = true,
}: {
  readonly customer: CustomerDetailRow;
  readonly contactRef: Ref<HTMLDivElement>;
  readonly showNotes?: boolean;
}) {
  const t = useTranslations("Customers");
  const address = customer.deliveryAddress;
  const contact = customer.contact;
  const addressLines = [
    address?.line,
    [address?.subdistrict, address?.district].filter(Boolean).join(" "),
    [address?.province, address?.postcode].filter(Boolean).join(" "),
  ].filter((line): line is string => Boolean(line));
  const addressText = useRef<HTMLSpanElement>(null);
  const [copyResult, setCopyResult] = useState<string>();
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(addressLines.join("\n"));
      setCopyResult(t("workspace.addressCopied"));
    } catch {
      if (addressText.current)
        window.getSelection()?.selectAllChildren(addressText.current);
      setCopyResult(t("workspace.addressCopyFailed"));
    }
  }
  return (
    <CustomerDetailCard title={t("sectionDelivery")}>
      {address?.label ? (
        <p className="font-medium wrap-anywhere text-text">{address.label}</p>
      ) : null}
      {addressLines.length > 0 ? (
        <p className="flex gap-2 text-sm text-text">
          <MapPin
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted"
          />
          <span ref={addressText} className="min-w-0 wrap-anywhere">
            {addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted">{t("noDelivery")}</p>
      )}
      {addressLines.length > 0 ? (
        <Button
          variant="link"
          className="h-auto min-h-touch px-0"
          onClick={() => void copyAddress()}
        >
          <Copy aria-hidden="true" className="size-4" />
          {t("workspace.copyAddress")}
        </Button>
      ) : null}
      <p role="status" className="text-sm text-muted">
        {copyResult}
      </p>
      <div
        ref={contactRef}
        tabIndex={-1}
        className="border-t border-border pt-3"
      >
        {contact?.name || contact?.role || contact?.phone || contact?.email ? (
          <div className="space-y-1 text-sm">
            {contact.name || contact.role ? (
              <p className="flex gap-2 text-text">
                <User
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted"
                />
                <span className="min-w-0 wrap-anywhere">
                  {[contact.name, contact.role].filter(Boolean).join(" · ")}
                </span>
              </p>
            ) : null}
            {contact.phone && telHref(contact.phone) ? (
              <a
                href={telHref(contact.phone)}
                className="-my-1 flex min-h-touch items-center gap-2 text-link hover:underline md:my-0 md:min-h-0"
              >
                <Phone aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 wrap-anywhere">{contact.phone}</span>
              </a>
            ) : contact.phone ? (
              // Nothing dialable: show it as written, without a link.
              <p className="flex items-center gap-2 text-text">
                <Phone
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted"
                />
                <span className="min-w-0 wrap-anywhere">{contact.phone}</span>
              </p>
            ) : null}
            {contact.email ? (
              <a
                href={mailtoHref(contact.email)}
                className="-my-1 flex min-h-touch items-center gap-2 text-link hover:underline md:my-0 md:min-h-0"
              >
                <Mail aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 wrap-anywhere">{contact.email}</span>
              </a>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("noContact")}</p>
        )}
      </div>
      {showNotes && customer.notes ? (
        <div className="border-t border-border pt-3">
          <h3 className="mb-1 font-medium">
            {t("workspace.deliveryInstructions")}
          </h3>
          <p className="text-sm wrap-anywhere whitespace-pre-line">
            {customer.notes}
          </p>
        </div>
      ) : null}
    </CustomerDetailCard>
  );
}

export function CustomerRegistration({
  customer,
  canManage,
}: {
  readonly customer: CustomerDetailRow;
  readonly canManage: boolean;
}) {
  const t = useTranslations("Customers");
  return (
    <CustomerDetailCard title={t("sectionTax")}>
      <DescriptionList
        layout="rows"
        items={[
          {
            id: "legalNameTh",
            label: t("legalNameTh"),
            value: customer.legalNameTh ?? DASH,
          },
          {
            id: "legalNameEn",
            label: t("legalNameEn"),
            value: customer.legalNameEn ?? DASH,
          },
          ...(canManage
            ? [
                {
                  id: "taxId",
                  label: t("taxId"),
                  value: customer.taxId ? (
                    <span className="font-mono">{customer.taxId}</span>
                  ) : (
                    DASH
                  ),
                },
              ]
            : []),
          {
            id: "establishment",
            label: t("establishment"),
            value:
              customer.establishment?.kind === "HEAD_OFFICE"
                ? t("headOffice")
                : customer.establishment?.kind === "BRANCH"
                  ? t("branch", { code: customer.establishment.code })
                  : DASH,
          },
        ]}
      />
      {customer.taxIdChecksumValid === false ? (
        <Notice
          tone="warning"
          title={t("taxIdChecksumWarning")}
          testId="customer-tax-id-warning"
        />
      ) : null}
    </CustomerDetailCard>
  );
}
