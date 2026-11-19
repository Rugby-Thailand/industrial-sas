import { fail, ok, type Result } from "../result";

const ASCII_TAX_ID = /^[0-9]{13}$/;
const BRANCH_CODE = /^[0-9]{5}$/;

export const CUSTOMER_FIELD_LIMITS = {
  name: 200,
  legalNameTh: 200,
  legalNameEn: 200,
  notes: 2000,
  deliveryAddress: {
    label: 200,
    line: 200,
    subdistrict: 200,
    district: 200,
    province: 200,
    postcode: 10,
  },
  contact: { name: 200, role: 200, phone: 32, email: 254 },
} as const;

export type CustomerEstablishment =
  { kind: "HEAD_OFFICE" } | { kind: "BRANCH"; code: string };

export type CustomerDeliveryAddress = Partial<
  Record<keyof typeof CUSTOMER_FIELD_LIMITS.deliveryAddress, string>
>;
export type CustomerContact = Partial<
  Record<keyof typeof CUSTOMER_FIELD_LIMITS.contact, string>
>;

export interface CustomerEditableInput {
  name: string;
  legalNameTh?: string;
  legalNameEn?: string;
  taxId?: string;
  establishment?: CustomerEstablishment;
  deliveryAddress?: CustomerDeliveryAddress;
  contact?: CustomerContact;
  notes?: string;
}

export function normalizeCustomerName(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function normalizeTaxId(raw: string): string | null {
  const id = raw.replace(/[\s-]/gu, "");
  return ASCII_TAX_ID.test(id) ? id : null;
}

export function isValidThaiTaxIdChecksum(id: string): boolean {
  if (!ASCII_TAX_ID.test(id)) return false;
  let weightedSum = 0;
  for (let index = 0; index < 12; index += 1) {
    weightedSum += Number(id[index]) * (13 - index);
  }
  return (11 - (weightedSum % 11)) % 10 === Number(id[12]);
}

export function isValidCustomerEstablishment(
  establishment: CustomerEstablishment,
): boolean {
  return (
    establishment.kind === "HEAD_OFFICE" ||
    (BRANCH_CODE.test(establishment.code) && establishment.code !== "00000")
  );
}

export function suggestNextCustomerCode(
  highestExisting: number | bigint = 0,
): string {
  return `C-${(BigInt(highestExisting) + 1n).toString().padStart(4, "0")}`;
}

type FieldError = { code: "FIELD_INVALID"; field: string };
const invalidField = (field: string) =>
  fail({ code: "FIELD_INVALID" as const, field });

function optionalTextFields<Field extends string>(
  fields: Partial<Record<NoInfer<Field>, string>> | undefined,
  limits: Readonly<Record<Field, number>>,
  prefix = "",
): Result<Partial<Record<Field, string>> | undefined, FieldError> {
  if (!fields) return ok(undefined);
  const cleaned: Partial<Record<Field, string>> = {};
  for (const field in limits) {
    const value = fields[field];
    if (!value?.trim()) continue;
    if (value.length > limits[field]) return invalidField(prefix + field);
    cleaned[field] = value;
  }
  return ok(Object.keys(cleaned).length > 0 ? cleaned : undefined);
}

export function validateCustomerFields(input: CustomerEditableInput) {
  const { name, establishment } = input;
  const normalizedName = normalizeCustomerName(name);
  if (!normalizedName || name.length > CUSTOMER_FIELD_LIMITS.name)
    return invalidField("name");

  const text = optionalTextFields(input, {
    legalNameTh: CUSTOMER_FIELD_LIMITS.legalNameTh,
    legalNameEn: CUSTOMER_FIELD_LIMITS.legalNameEn,
    notes: CUSTOMER_FIELD_LIMITS.notes,
  });
  if (!text.ok) return text;
  const rawTaxId = input.taxId?.trim();
  const taxId = rawTaxId ? normalizeTaxId(rawTaxId) : undefined;
  if (taxId === null) return invalidField("taxId");
  if (establishment && !isValidCustomerEstablishment(establishment))
    return invalidField("establishment.code");

  const deliveryAddress = optionalTextFields(
    input.deliveryAddress,
    CUSTOMER_FIELD_LIMITS.deliveryAddress,
    "deliveryAddress.",
  );
  if (!deliveryAddress.ok) return deliveryAddress;

  const contact = optionalTextFields(
    input.contact,
    CUSTOMER_FIELD_LIMITS.contact,
    "contact.",
  );
  if (!contact.ok) return contact;
  const email = contact.value?.email;
  if (email !== undefined && !email.includes("@"))
    return invalidField("contact.email");

  // Undefined optional fields are part of the patch, so an edit can clear them.
  return ok({
    name,
    normalizedName,
    legalNameTh: text.value?.legalNameTh,
    legalNameEn: text.value?.legalNameEn,
    taxId,
    establishment,
    deliveryAddress: deliveryAddress.value,
    contact: contact.value,
    notes: text.value?.notes,
  });
}
