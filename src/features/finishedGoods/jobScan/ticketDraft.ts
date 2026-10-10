import {
  classifyTicketBarcode,
  JOB_TICKET_CODE_LIMITS,
} from "../../../../convex/model/finishedGoods/jobScans";

export { classifyTicketBarcode, JOB_TICKET_CODE_LIMITS as TICKET_CODE_LIMITS };

export const REQUIRED_FIELDS = ["factoryOrder", "productBarcodeText"] as const;
export type TicketCodeField = (typeof REQUIRED_FIELDS)[number];

/** Field scanning must not redirect a wrong label to another field or accept a storage QR. */
export function ticketBarcodeError(field: TicketCodeField, code: string) {
  const value = code.trim();
  if (
    !value ||
    /^ISAS:/i.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return "invalidTicketBarcode" as const;
  if (value.length > JOB_TICKET_CODE_LIMITS[field])
    return "scanCodeTooLong" as const;
  if (classifyTicketBarcode(value) !== field) return "wrongScanField" as const;
  return undefined;
}
export const DETAIL_FIELDS = [
  "partName",
  "customer",
  "deliveryDate",
  "manufacturingDate",
  "quantity",
  "factoryQuantity",
  "customerQuantity",
] as const;
export const NUMBER_FIELDS = new Set([
  "quantity",
  "factoryQuantity",
  "customerQuantity",
]);
export type TicketField =
  (typeof REQUIRED_FIELDS)[number] | (typeof DETAIL_FIELDS)[number];

/** Location chosen before scanning; unmapped locations keep only their text. */
export type PickedLocation = {
  text: string;
  locationId?: string;
  buildingId?: string;
  buildingName?: string;
  floorId?: string;
  floorNumber?: number;
  layoutPending?: boolean;
  zoneId?: string;
  supportPositionId?: string;
  code?: string;
  name?: string;
};

export type TicketDraft = {
  key: string;
  storageFormat?: "PALLET" | "BOX" | "OTHER";
  source: "AI" | "BARCODE" | "MANUAL";
  status: "reading" | "ready";
  values: Partial<Record<TicketField, string>>;
  /** Fields the AI filled that nobody has edited yet. */
  aiFields: TicketField[];
  previewUrl?: string;
  imageUrl?: string;
  aiUsageOperationId?: string;
  aiRaw?: string;
  notice?:
    | "aiFilled"
    | "aiMock"
    | "aiFailed"
    | "uploadFailed"
    | "photoProcessingFailed";
};

export const newTicket = (
  source: TicketDraft["source"],
  values: TicketDraft["values"] = {},
): TicketDraft => ({
  key: crypto.randomUUID(),
  source,
  status: "ready",
  storageFormat: "PALLET",
  values,
  aiFields: [],
});

export const isComplete = (ticket: TicketDraft) =>
  REQUIRED_FIELDS.every((field) => ticket.values[field]?.trim());

/** Do not silently drop a mistyped optional quantity during serialization. */
function parseTicketQuantity(value: string): number | undefined {
  // A comma groups three digits; it is never a decimal separator or empty zero.
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(value))
    return undefined;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

export function hasInvalidQuantity(ticket: TicketDraft) {
  return [...NUMBER_FIELDS].some((field) => {
    const value = ticket.values[field as TicketField]?.trim();
    if (!value) return false;
    return parseTicketQuantity(value) === undefined;
  });
}

/** Repeated identities can be separate pallets; require an explicit review. */
export function duplicateTicketKeys(tickets: readonly TicketDraft[]): string[] {
  const groups = new Map<string, string[]>();
  for (const ticket of tickets) {
    if (!isComplete(ticket)) continue;
    const identity = JSON.stringify(
      REQUIRED_FIELDS.map((field) => ticket.values[field]!.trim()),
    );
    groups.set(identity, [...(groups.get(identity) ?? []), ticket.key]);
  }
  return [...groups.values()].filter((group) => group.length > 1).flat();
}

/** Adds AI output without overwriting anything the user already typed. */
export function mergeExtracted(
  ticket: TicketDraft,
  fields: Partial<Record<TicketField, string | number>>,
): TicketDraft {
  const values = { ...ticket.values };
  const aiFields: TicketField[] = [];
  for (const [field, value] of Object.entries(fields) as [
    TicketField,
    string | number,
  ][]) {
    if (values[field]?.trim() || value === undefined || value === "") continue;
    values[field] = String(value);
    aiFields.push(field);
  }
  return { ...ticket, values, aiFields };
}

/** Puts a scanned code into the newest ticket still missing that field, else starts a new ticket. */
export function applyBarcode(
  tickets: TicketDraft[],
  code: string,
): { tickets: TicketDraft[]; field: TicketField } {
  const field = classifyTicketBarcode(code);
  let index = tickets.length - 1;
  while (
    index >= 0 &&
    (tickets[index]!.status !== "ready" ||
      tickets[index]!.values[field]?.trim())
  )
    index--;
  if (index === -1)
    return {
      tickets: [...tickets, newTicket("BARCODE", { [field]: code })],
      field,
    };
  return {
    tickets: tickets.map((ticket, i) =>
      i === index
        ? { ...ticket, values: { ...ticket.values, [field]: code } }
        : ticket,
    ),
    field,
  };
}

/** A single photographed ticket keeps its identities together and never overwrites a different label. */
export function applyImageBarcodes(
  tickets: TicketDraft[],
  codes: string[],
): TicketDraft[] {
  if (codes.length !== 2)
    return codes.reduce(
      (rows, code) => applyBarcode(rows, code).tickets,
      tickets,
    );
  const fields = Object.fromEntries(
    codes.map((code) => [classifyTicketBarcode(code), code]),
  );
  if (!fields.factoryOrder || !fields.productBarcodeText) return tickets;
  let index = tickets.length - 1;
  while (
    index >= 0 &&
    !(
      tickets[index]!.status === "ready" &&
      !isComplete(tickets[index]!) &&
      REQUIRED_FIELDS.every(
        (field) =>
          !tickets[index]!.values[field]?.trim() ||
          tickets[index]!.values[field]?.trim() === fields[field],
      )
    )
  )
    index--;
  if (index < 0) return [...tickets, newTicket("BARCODE", fields)];
  return tickets.map((ticket, i) =>
    i === index
      ? { ...ticket, values: { ...ticket.values, ...fields } }
      : ticket,
  );
}

export function toPayload(ticket: TicketDraft) {
  const item: Record<string, string | number> = { source: ticket.source };
  for (const field of [...REQUIRED_FIELDS, ...DETAIL_FIELDS]) {
    const value = ticket.values[field]?.trim();
    if (!value) continue;
    if (NUMBER_FIELDS.has(field)) {
      const number = parseTicketQuantity(value);
      if (number !== undefined) item[field] = number;
    } else item[field] = value;
  }
  if (ticket.storageFormat) item["storageFormat"] = ticket.storageFormat;
  if (ticket.imageUrl) item["imageUrl"] = ticket.imageUrl;
  if (ticket.aiUsageOperationId)
    item["aiUsageOperationId"] = ticket.aiUsageOperationId;
  if (ticket.aiRaw) item["aiRaw"] = ticket.aiRaw;
  return item as {
    factoryOrder: string;
    productBarcodeText: string;
    source: TicketDraft["source"];
  } & Record<string, string | number>;
}

export function pickedLocationPayload(location: PickedLocation) {
  return location.locationId
    ? { locationId: location.locationId }
    : location.zoneId
      ? {
          zoneId: location.zoneId,
          ...(location.supportPositionId
            ? { supportPositionId: location.supportPositionId }
            : {}),
        }
      : undefined;
}
