import {
  isValidThaiTaxIdChecksum,
  type CustomerEditableInput,
} from "../../../convex/model/customers/customers";

/** Every editable field as the form holds it: plain strings, never undefined. */
export interface CustomerDraft {
  readonly code: string;
  readonly name: string;
  readonly legalNameTh: string;
  readonly legalNameEn: string;
  readonly taxId: string;
  readonly establishment: "" | "HEAD_OFFICE" | "BRANCH";
  readonly branchCode: string;
  readonly addressLabel: string;
  readonly addressLine: string;
  readonly subdistrict: string;
  readonly district: string;
  readonly province: string;
  readonly postcode: string;
  readonly contactName: string;
  readonly contactRole: string;
  readonly phone: string;
  readonly email: string;
  readonly notes: string;
}

export type CustomerDraftField = keyof CustomerDraft;

export const EMPTY_CUSTOMER_DRAFT: CustomerDraft = Object.freeze({
  code: "",
  name: "",
  legalNameTh: "",
  legalNameEn: "",
  taxId: "",
  establishment: "",
  branchCode: "",
  addressLabel: "",
  addressLine: "",
  subdistrict: "",
  district: "",
  province: "",
  postcode: "",
  contactName: "",
  contactRole: "",
  phone: "",
  email: "",
  notes: "",
});

/** The stored shape the detail query returns, reduced to what the form edits. */
export interface CustomerRecord extends CustomerEditableInput {
  readonly code: string;
}

export function draftFromCustomer(customer: CustomerRecord): CustomerDraft {
  const address = customer.deliveryAddress ?? {};
  const contact = customer.contact ?? {};
  return {
    code: customer.code,
    name: customer.name,
    legalNameTh: customer.legalNameTh ?? "",
    legalNameEn: customer.legalNameEn ?? "",
    taxId: customer.taxId ?? "",
    establishment: customer.establishment?.kind ?? "",
    branchCode:
      customer.establishment?.kind === "BRANCH"
        ? customer.establishment.code
        : "",
    addressLabel: address.label ?? "",
    addressLine: address.line ?? "",
    subdistrict: address.subdistrict ?? "",
    district: address.district ?? "",
    province: address.province ?? "",
    postcode: address.postcode ?? "",
    contactName: contact.name ?? "",
    contactRole: contact.role ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    notes: customer.notes ?? "",
  };
}

/** Trimmed text, or nothing: blank optional fields are cleared, not stored. */
function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Drops keys whose value is undefined, and the object itself when empty. */
function compact<T extends Record<string, string | undefined>>(
  value: T,
): Partial<Record<keyof T, string>> | undefined {
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as Partial<Record<keyof T, string>>);
}

/** The mutation's editable arguments. The server validates and normalizes again. */
export function customerInput(draft: CustomerDraft): CustomerEditableInput {
  const deliveryAddress = compact({
    label: text(draft.addressLabel),
    line: text(draft.addressLine),
    subdistrict: text(draft.subdistrict),
    district: text(draft.district),
    province: text(draft.province),
    postcode: text(draft.postcode),
  });
  const contact = compact({
    name: text(draft.contactName),
    role: text(draft.contactRole),
    phone: text(draft.phone),
    email: text(draft.email),
  });
  const optional = {
    legalNameTh: text(draft.legalNameTh),
    legalNameEn: text(draft.legalNameEn),
    taxId: text(draft.taxId),
    establishment:
      draft.establishment === "HEAD_OFFICE"
        ? ({ kind: "HEAD_OFFICE" } as const)
        : draft.establishment === "BRANCH"
          ? ({ kind: "BRANCH", code: draft.branchCode.trim() } as const)
          : undefined,
    deliveryAddress,
    contact,
    notes: text(draft.notes),
  };
  return {
    name: draft.name.trim(),
    ...Object.fromEntries(
      Object.entries(optional).filter(([, value]) => value !== undefined),
    ),
  };
}

/** Digits a person typed, ignoring the spaces and dashes the server strips. */
export function taxIdDigits(value: string): string {
  return value.replace(/[\s-]/gu, "");
}

export type TaxIdState = "EMPTY" | "VALID" | "CHECKSUM" | "LENGTH";

/** Length is a hard rule; a failed check digit only warns (plan acceptance 3). */
export function taxIdState(value: string): TaxIdState {
  const digits = taxIdDigits(value);
  if (digits === "") return "EMPTY";
  if (!/^\d{13}$/u.test(digits)) return "LENGTH";
  return isValidThaiTaxIdChecksum(digits) ? "VALID" : "CHECKSUM";
}

/** Which form section a server field name belongs to, so it can open. */
export type CustomerSection = "tax" | "address" | "contact" | "notes";

export function sectionForField(
  field: string | undefined,
): CustomerSection | undefined {
  if (field === undefined) return undefined;
  if (
    field.startsWith("taxId") ||
    field.startsWith("establishment") ||
    field.startsWith("legalName")
  )
    return "tax";
  if (field.startsWith("deliveryAddress")) return "address";
  if (field.startsWith("contact")) return "contact";
  if (field === "notes") return "notes";
  return undefined;
}

/** Number of filled fields in each collapsible section, for its summary badge. */
export function sectionFilled(
  draft: CustomerDraft,
  section: CustomerSection,
): number {
  const fields: Record<CustomerSection, readonly CustomerDraftField[]> = {
    tax: ["legalNameTh", "legalNameEn", "taxId", "establishment"],
    address: [
      "addressLabel",
      "addressLine",
      "subdistrict",
      "district",
      "province",
      "postcode",
    ],
    contact: ["contactName", "contactRole", "phone", "email"],
    notes: ["notes"],
  };
  return fields[section].filter((field) => draft[field].trim() !== "").length;
}
