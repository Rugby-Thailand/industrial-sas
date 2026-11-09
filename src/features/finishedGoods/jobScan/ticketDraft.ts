import {
  MAX_JOB_SCAN_ITEMS,
  classifyTicketBarcode,
  JOB_TICKET_CODE_LIMITS,
  JOB_TICKET_TEXT_LIMITS,
  MAX_JOB_TICKET_QUANTITY,
} from "../../../../convex/model/finishedGoods/jobScans";

export {
  MAX_JOB_SCAN_ITEMS,
  classifyTicketBarcode,
  JOB_TICKET_CODE_LIMITS as TICKET_CODE_LIMITS,
};

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

export function ticketFieldMaxLength(field: TicketField) {
  return field in JOB_TICKET_TEXT_LIMITS
    ? JOB_TICKET_TEXT_LIMITS[field as keyof typeof JOB_TICKET_TEXT_LIMITS]
    : undefined;
}

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
  return Number.isFinite(number) && number <= MAX_JOB_TICKET_QUANTITY
    ? number
    : undefined;
}

export function hasInvalidQuantity(ticket: TicketDraft) {
  return [...NUMBER_FIELDS].some((field) => {
    const value = ticket.values[field as TicketField]?.trim();
    if (!value) return false;
    return parseTicketQuantity(value) === undefined;
  });
}

/** Includes AI-filled values, which bypass input maxLength. */
export function ticketFieldError(ticket: TicketDraft) {
  for (const field of [...REQUIRED_FIELDS, ...DETAIL_FIELDS]) {
    const value = ticket.values[field] ?? "";
    const limit = ticketFieldMaxLength(field);
    if (limit !== undefined && value.length > limit)
      return { code: "FIELD_TOO_LONG" as const, field };
    if (
      NUMBER_FIELDS.has(field) &&
      value.trim() &&
      parseTicketQuantity(value.trim()) === undefined
    )
      return { code: "FIELD_INVALID" as const, field };
  }
  return null;
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

/** The ticket an intake wrote; absent when the intake changed nothing. */
export type TicketWrite = { key: string; field: TicketCodeField };

/** One barcode-panel intake, with exactly what is needed to revert it. */
export type TicketIntake = TicketWrite & {
  /** Codes this intake put into previously empty fields. */
  codes: Partial<Record<TicketCodeField, string>>;
  /** The intake started this ticket. */
  created: boolean;
};

export function describeIntake(
  before: readonly TicketDraft[],
  after: readonly TicketDraft[],
  written: TicketWrite,
): TicketIntake {
  const previous = before.find((ticket) => ticket.key === written.key);
  const ticket = after.find((row) => row.key === written.key);
  const codes: TicketIntake["codes"] = {};
  for (const field of REQUIRED_FIELDS) {
    const value = ticket?.values[field]?.trim();
    if (value && !previous?.values[field]?.trim()) codes[field] = value;
  }
  return { ...written, codes, created: !previous };
}

/**
 * Reverts one intake: clears its codes, and removes the ticket when the intake
 * started it and nothing else was added. Returns undefined when the codes are
 * no longer in place, so a changed ticket is never altered.
 */
export function undoIntake(
  tickets: readonly TicketDraft[],
  intake: TicketIntake,
): TicketDraft[] | undefined {
  const ticket = tickets.find((row) => row.key === intake.key);
  const fields = Object.keys(intake.codes) as TicketCodeField[];
  if (
    !ticket ||
    ticket.status !== "ready" ||
    !fields.length ||
    fields.some((field) => ticket.values[field]?.trim() !== intake.codes[field])
  )
    return undefined;
  const values = { ...ticket.values };
  for (const field of fields) delete values[field];
  if (intake.created && !Object.values(values).some((value) => value?.trim()))
    return tickets.filter((row) => row !== ticket);
  return tickets.map((row) => (row === ticket ? { ...row, values } : row));
}

/** Puts a scanned code into the newest ticket still missing that field, else starts a new ticket. */
export function applyBarcode(
  tickets: TicketDraft[],
  code: string,
  maximum = MAX_JOB_SCAN_ITEMS,
): { tickets: TicketDraft[]; field: TicketCodeField; written?: TicketWrite } {
  const field = classifyTicketBarcode(code);
  let index = tickets.length - 1;
  while (
    index >= 0 &&
    (tickets[index]!.status !== "ready" ||
      tickets[index]!.values[field]?.trim())
  )
    index--;
  if (index === -1) {
    if (tickets.length >= maximum) return { tickets, field };
    const ticket = newTicket("BARCODE", { [field]: code });
    return {
      tickets: [...tickets, ticket],
      field,
      written: { key: ticket.key, field },
    };
  }
  return {
    tickets: tickets.map((ticket, i) =>
      i === index
        ? { ...ticket, values: { ...ticket.values, [field]: code } }
        : ticket,
    ),
    field,
    written: { key: tickets[index]!.key, field },
  };
}

/** A single photographed ticket keeps its identities together and never overwrites a different label. */
export function applyImageBarcodes(
  tickets: TicketDraft[],
  codes: string[],
  maximum = MAX_JOB_SCAN_ITEMS,
): { tickets: TicketDraft[]; written?: TicketWrite } {
  if (codes.length !== 2)
    return codes.reduce<{ tickets: TicketDraft[]; written?: TicketWrite }>(
      (result, code) => {
        const next = applyBarcode(result.tickets, code, maximum);
        // Report the last code that was actually written.
        const written = next.written ?? result.written;
        return written
          ? { tickets: next.tickets, written }
          : { tickets: next.tickets };
      },
      { tickets },
    );
  const fields = Object.fromEntries(
    codes.map((code) => [classifyTicketBarcode(code), code]),
  );
  if (!fields.factoryOrder || !fields.productBarcodeText) return { tickets };
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
  if (index < 0) {
    if (tickets.length >= maximum) return { tickets };
    const ticket = newTicket("BARCODE", fields);
    return {
      tickets: [...tickets, ticket],
      written: { key: ticket.key, field: "factoryOrder" },
    };
  }
  return {
    tickets: tickets.map((ticket, i) =>
      i === index
        ? { ...ticket, values: { ...ticket.values, ...fields } }
        : ticket,
    ),
    written: {
      key: tickets[index]!.key,
      field: tickets[index]!.values.factoryOrder?.trim()
        ? "productBarcodeText"
        : "factoryOrder",
    },
  };
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
