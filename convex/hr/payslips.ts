/** Private, immutable imported statements. Never serialize amounts while masked. */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "../lib/idempotency";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { fromLocal, isIsoDate } from "../model/hr/calendar";
import {
  freshUntil,
  MAX_IMPORT_ROWS,
  selectPayslipSource,
  pdfBytes,
  pdfHash,
} from "../model/hr/payslip";
import { deliverNotification } from "./notifications";
import { activePolicy, policyVersions } from "./policies";
import {
  fail,
  hrCommand,
  siteAllowed,
  linkedEmployee,
  orgClock,
  siteScope,
  type Employee,
} from "./shared";

type Statement = Doc<"hrPayslipRows">;
const ADMIN = HR_PERMISSION.adminManage;
const SELF = HR_PERMISSION.selfAccess;
const capabilities = () =>
  process.env.HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED === "true" &&
  process.env.HR_PAYSLIP_PRIVATE_STORAGE_ENABLED === "true";
async function policyOf(ctx: TenantFunctionContext) {
  const clock = orgClock(ctx);
  return clock ? await activePolicy(ctx, "PAYSLIPS", clock.today) : null;
}
async function policyMetadata(
  ctx: TenantFunctionContext,
  policy: Doc<"hrPolicyVersions">,
) {
  const clock = orgClock(ctx);
  const versions = await policyVersions(ctx, "PAYSLIPS");
  const next = clock
    ? versions
        ?.filter((version) => version.effectiveDate > clock.today)
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0]
    : undefined;
  return {
    verificationMinutes: policy.config.verificationMinutes,
    policyVersionId: policy._id,
    capabilityAvailable: capabilities(),
    ...(next && clock
      ? { policyChangesAt: fromLocal(next.effectiveDate, 0, clock.offset) }
      : {}),
  };
}
const rowMetadata = (row: Statement) => ({
  id: row._id,
  from: row.from,
  to: row.to,
  paymentDate: row.paymentDate,
  version: row.version,
  publishedAt: row.publishedAt,
  superseded: row.supersededById !== undefined,
});
async function versions(
  ctx: TenantFunctionContext,
  employeeId: string,
  from: string,
) {
  return await ctx.tenantDb
    .byIndex<Statement>("hrPayslipRows", "by_orgId_employeeId_from", [
      { field: "employeeId", value: employeeId },
      { field: "from", value: from },
    ])
    .all(101);
}
async function ownedPublished(ctx: TenantFunctionContext, rowId: string) {
  const employee = await linkedEmployee(ctx);
  if (!employee) return null;
  const row = await ctx.tenantDb.get<Statement>("hrPayslipRows", rowId);
  return row?.employeeId === employee._id &&
    row.publishedAt !== undefined &&
    row.supersededById === undefined
    ? row
    : null;
}
const verifiedExpiry = (ctx: TenantFunctionContext, minutes: number) =>
  capabilities() ? freshUntil(ctx.identity, minutes, Date.now()) : null;

export const list = queryWithOrg({
  args: { cursor: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrPayslipRows" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const policy = await policyOf(ctx);
    if (!policy) return { ok: false as const, code: "POLICY_NOT_ACTIVE" };
    const page = await ctx.tenantDb
      .byIndex<Statement>("hrPayslipRows", "by_orgId_employeeId_from", [
        { field: "employeeId", value: employee._id },
      ])
      .page({ limit: 20, cursor: args.cursor, order: "desc" });
    return {
      ok: true as const,
      items: page.page
        .filter((row) => row.publishedAt !== undefined)
        .map(rowMetadata),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      ...(await policyMetadata(ctx, policy)),
    };
  },
});

/** Exact notification/deep-link metadata, with no amounts or original bytes. */
export const metadata = queryWithOrg({
  args: { rowId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrPayslipRows" },
  handler: async (ctx, args) => {
    const employee = await linkedEmployee(ctx);
    if (!employee) return { ok: false as const, code: "HR_NOT_LINKED" };
    const row = await ctx.tenantDb.get<Statement>("hrPayslipRows", args.rowId);
    if (
      !row ||
      row.employeeId !== employee._id ||
      row.publishedAt === undefined
    )
      return { ok: false as const, code: "NOT_FOUND" };
    const policy = await policyOf(ctx);
    if (!policy) return { ok: false as const, code: "POLICY_NOT_ACTIVE" };
    return {
      ok: true as const,
      item: rowMetadata(row),
      ...(await policyMetadata(ctx, policy)),
      ...(row.supersededById ? { replacementId: row.supersededById } : {}),
    };
  },
});

export const imports = queryWithOrg({
  args: { cursor: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPayslipImports" },
  handler: async (ctx, args) => {
    // Import batches can contain several sites; only org-wide publishers may
    // inspect them. A site-scoped HR grant cannot reveal another site's source.
    if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
      return { ok: false as const, code: "POLICY_ORG_SCOPE_REQUIRED" };
    const policy = await policyOf(ctx);
    if (!policy) return { ok: false as const, code: "POLICY_NOT_ACTIVE" };
    const page = await ctx.tenantDb
      .byIndex<Doc<"hrPayslipImports">>(
        "hrPayslipImports",
        "by_orgId_createdAt",
      )
      .page({ limit: 20, cursor: args.cursor, order: "desc" });
    const items = [];
    for (const batch of page.page) {
      const rows = await ctx.tenantDb
        .byIndex<Statement>("hrPayslipRows", "by_orgId_importId", [
          { field: "importId", value: batch._id },
        ])
        .take(MAX_IMPORT_ROWS + 1);
      items.push({
        id: batch._id,
        from: batch.from,
        to: batch.to,
        sourceName: batch.sourceName,
        sourceHash: batch.sourceHash,
        status: batch.status,
        rowCount: batch.rowCount,
        exclusions: batch.exclusions ?? [],
        rows: rows.map((row) => ({
          ...rowMetadata(row),
          employeeCode: row.employeeCode,
          employeeName: row.employeeName,
          gross: row.gross,
          deductions: row.deductions,
          net: row.net,
          sourceHash: row.sourceHash,
        })),
      });
    }
    return {
      ok: true as const,
      items,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      hashRequired: policy.config.requireFileHash,
    };
  },
});

export const stage = mutationWithOrg({
  args: {
    requestId: v.string(),
    from: v.string(),
    to: v.string(),
    sourceName: v.string(),
    csv: v.string(),
    sourceConfirmed: v.boolean(),
    exclusions: v.optional(
      v.array(v.object({ rowNumber: v.number(), reason: v.string() })),
    ),
    documents: v.array(
      v.object({
        employeeCode: v.string(),
        base64: v.string(),
        expectedHash: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPayslipImports" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.payslip.stage",
      requestId: args.requestId,
      payload: args,
      table: "hrPayslipImports",
      replay: async (id) => {
        const batch = await ctx.tenantDb.get<Doc<"hrPayslipImports">>(
          "hrPayslipImports",
          id,
        );
        return batch && ctx.tenant.membership.scopeMode === "ORG_WIDE"
          ? { rowCount: batch.rowCount }
          : null;
      },
      run: async () => {
        if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
          return fail("POLICY_ORG_SCOPE_REQUIRED");
        const policy = await policyOf(ctx);
        if (!policy) return fail("POLICY_NOT_ACTIVE");
        if (!capabilities()) return fail("PAYSLIP_CAPABILITY_UNAVAILABLE");
        if (!args.sourceConfirmed)
          return fail(
            "PAYSLIP_SOURCE_CONFIRMATION_REQUIRED",
            "sourceConfirmed",
          );
        if (!isIsoDate(args.from) || !isIsoDate(args.to) || args.from > args.to)
          return fail("PAYSLIP_PERIOD_INVALID");
        if (
          !args.sourceName.trim() ||
          args.sourceName.length > 120 ||
          args.csv.length > 100_000 ||
          args.documents.length > MAX_IMPORT_ROWS ||
          args.documents.reduce(
            (sum, document) => sum + document.base64.length,
            0,
          ) >
            4 * 1024 * 1024
        )
          return fail("PAYSLIP_SOURCE_INVALID");
        const parsed = selectPayslipSource(args.csv, args.exclusions);
        if (parsed.errors.length)
          return fail("PAYSLIP_CSV_INVALID", parsed.errors.join(";"));
        if (
          args.documents.length !== parsed.rows.length ||
          new Set(args.documents.map((file) => file.employeeCode)).size !==
            parsed.rows.length
        )
          return fail("PAYSLIP_DOCUMENT_MAPPING_INVALID");
        const scope = await siteScope(ctx);
        const validated = [];
        for (const source of parsed.rows) {
          if (
            source.from !== args.from ||
            source.to !== args.to ||
            !isIsoDate(source.paymentDate)
          )
            return fail("PAYSLIP_PERIOD_MISMATCH", source.code);
          const employee = await ctx.tenantDb
            .byIndex<Employee>("hrEmployees", "by_orgId_code", [
              { field: "code", value: source.code },
            ])
            .unique();
          if (
            !employee ||
            !(await siteAllowed(ctx, scope, employee.warehouseId))
          )
            return fail("PAYSLIP_EMPLOYEE_UNKNOWN", source.code);
          const file = args.documents.find(
            (document) => document.employeeCode === source.code,
          );
          if (!file)
            return fail("PAYSLIP_DOCUMENT_MAPPING_INVALID", source.code);
          const bytes = pdfBytes(file.base64);
          if (!bytes) return fail("PAYSLIP_PDF_INVALID", source.code);
          const hash = await pdfHash(bytes);
          if (
            (policy.config.requireFileHash && !file.expectedHash) ||
            (file.expectedHash !== undefined &&
              file.expectedHash.toLowerCase() !== hash)
          )
            return fail("PAYSLIP_HASH_MISMATCH", source.code);
          const prior = await versions(ctx, employee._id, args.from);
          if (prior.length >= 100) return fail("PAYSLIP_VERSION_LIMIT");
          const latest = prior
            .filter((row) => row.publishedAt !== undefined)
            .sort((a, b) => b.version - a.version)[0];
          validated.push({
            source,
            employee,
            file,
            hash,
            predecessorId: latest?._id,
          });
        }
        const sourceHash = await sha256Hex(args.csv);
        const id = await ctx.tenantDb.insert("hrPayslipImports", {
          from: args.from,
          to: args.to,
          sourceName: args.sourceName.trim(),
          sourceCsv: args.csv,
          sourceHash,
          policyVersionId: policy._id,
          status: "STAGED",
          rowCount: validated.length,
          exclusions: parsed.exclusions,
          inclusionHash: await sha256Hex(
            JSON.stringify(
              parsed.exclusions.map((row) => [
                row.rowNumber,
                row.employeeCode,
                row.reason,
              ]),
            ),
          ),
          createdAt: Date.now(),
          createdByUserId: ctx.tenant.actor._id,
        });
        for (const row of validated)
          await ctx.tenantDb.insert("hrPayslipRows", {
            importId: id,
            employeeId: row.employee._id,
            warehouseId: row.employee.warehouseId,
            employeeCode: row.employee.code,
            employeeName: row.employee.displayName,
            from: row.source.from,
            to: row.source.to,
            paymentDate: row.source.paymentDate,
            gross: row.source.gross,
            deductions: row.source.deductions,
            net: row.source.net,
            sourceBase64: row.file.base64,
            sourceHash: row.hash,
            version: 0,
            ...(row.predecessorId ? { predecessorId: row.predecessorId } : {}),
          });
        return {
          documentId: id,
          extra: { rowCount: validated.length },
          changes: [
            { field: "sourceHash", to: sourceHash },
            { field: "rowCount", to: String(validated.length) },
            { field: "excludedRows", to: String(parsed.exclusions.length) },
          ],
        };
      },
    }),
});

export const publish = mutationWithOrg({
  args: {
    requestId: v.string(),
    importId: v.string(),
    replacementConfirmed: v.boolean(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPayslipImports" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.payslip.publish",
      requestId: args.requestId,
      payload: args,
      table: "hrPayslipImports",
      replay: async (id) => {
        const batch = await ctx.tenantDb.get<Doc<"hrPayslipImports">>(
          "hrPayslipImports",
          id,
        );
        return batch && ctx.tenant.membership.scopeMode === "ORG_WIDE"
          ? { rowCount: batch.rowCount }
          : null;
      },
      run: async () => {
        if (ctx.tenant.membership.scopeMode !== "ORG_WIDE")
          return fail("POLICY_ORG_SCOPE_REQUIRED");
        const policy = await policyOf(ctx);
        if (!policy) return fail("POLICY_NOT_ACTIVE");
        if (!capabilities()) return fail("PAYSLIP_CAPABILITY_UNAVAILABLE");
        const batch = await ctx.tenantDb.get<Doc<"hrPayslipImports">>(
          "hrPayslipImports",
          args.importId,
        );
        if (!batch) return fail("NOT_FOUND");
        if (batch.status !== "STAGED") return fail("PAYSLIP_ALREADY_PUBLISHED");
        if (batch.policyVersionId !== policy._id)
          return fail("PAYSLIP_POLICY_CHANGED");
        if ((await sha256Hex(batch.sourceCsv)) !== batch.sourceHash)
          return fail("PAYSLIP_SOURCE_INTEGRITY_FAILED");
        if (
          (batch.exclusions?.length || batch.inclusionHash) &&
          batch.inclusionHash !==
            (await sha256Hex(
              JSON.stringify(
                (batch.exclusions ?? []).map((row) => [
                  row.rowNumber,
                  row.employeeCode,
                  row.reason,
                ]),
              ),
            ))
        )
          return fail("PAYSLIP_SOURCE_INTEGRITY_FAILED");
        const source = selectPayslipSource(batch.sourceCsv, batch.exclusions);
        if (source.errors.length)
          return fail("PAYSLIP_SOURCE_INTEGRITY_FAILED");
        const rows = await ctx.tenantDb
          .byIndex<Statement>("hrPayslipRows", "by_orgId_importId", [
            { field: "importId", value: batch._id },
          ])
          .take(MAX_IMPORT_ROWS + 1);
        if (
          !rows.length ||
          rows.length !== batch.rowCount ||
          rows.length !== source.rows.length ||
          rows.length > MAX_IMPORT_ROWS
        )
          return fail("PAYSLIP_BATCH_INCOMPLETE");
        const checked = [];
        for (const row of rows) {
          const canonical = source.rows.find(
            (sourceRow) => sourceRow.code === row.employeeCode,
          );
          const bytes = pdfBytes(row.sourceBase64);
          if (
            !canonical ||
            canonical.from !== row.from ||
            canonical.to !== row.to ||
            canonical.paymentDate !== row.paymentDate ||
            canonical.gross !== row.gross ||
            canonical.deductions !== row.deductions ||
            canonical.net !== row.net ||
            !bytes ||
            (await pdfHash(bytes)) !== row.sourceHash
          )
            return fail("PAYSLIP_SOURCE_INTEGRITY_FAILED");
          const employee = await ctx.tenantDb.get<Employee>(
            "hrEmployees",
            row.employeeId,
          );
          if (!employee || employee.code !== row.employeeCode)
            return fail("PAYSLIP_EMPLOYEE_CHANGED", row.employeeCode);
          const prior = await versions(ctx, row.employeeId, row.from);
          if (prior.length > 100) return fail("PAYSLIP_VERSION_LIMIT");
          const latest = prior
            .filter((candidate) => candidate.publishedAt !== undefined)
            .sort((a, b) => b.version - a.version)[0];
          if (latest?._id !== row.predecessorId)
            return fail("PAYSLIP_PUBLICATION_STALE");
          if (latest && !args.replacementConfirmed)
            return fail("PAYSLIP_REPLACEMENT_CONFIRMATION_REQUIRED");
          checked.push({ row, latest });
        }
        const now = Date.now();
        for (const { row, latest } of checked) {
          const version = (latest?.version ?? 0) + 1;
          await ctx.tenantDb.patch("hrPayslipRows", row._id, {
            version,
            publishedAt: now,
          });
          if (latest)
            await ctx.tenantDb.patch("hrPayslipRows", latest._id, {
              supersededById: row._id,
            });
          await deliverNotification(ctx, {
            employeeId: row.employeeId,
            event: "PAYSLIP_PUBLISHED",
            eventKey: `payslip:${row._id}:${version}`,
            title: "Payslip published",
            resourceId: row._id,
          });
        }
        await ctx.tenantDb.patch("hrPayslipImports", batch._id, {
          status: "PUBLISHED",
          publishedAt: now,
          publishedByUserId: ctx.tenant.actor._id,
        });
        return {
          documentId: batch._id,
          extra: { rowCount: rows.length },
          changes: [{ field: "status", from: "STAGED", to: "PUBLISHED" }],
        };
      },
    }),
});

async function revealed(ctx: TenantFunctionContext, rowId: string) {
  const row = await ownedPublished(ctx, rowId);
  if (!row) return fail("NOT_FOUND");
  const policy = await policyOf(ctx);
  if (!policy) return fail("POLICY_NOT_ACTIVE");
  if (!capabilities()) return fail("PAYSLIP_CAPABILITY_UNAVAILABLE");
  const expiresAt = verifiedExpiry(ctx, policy.config.verificationMinutes);
  if (!expiresAt) return fail("REVERIFICATION_REQUIRED");
  return {
    ...rowMetadata(row),
    policyVersionId: policy._id,
    gross: row.gross,
    deductions: row.deductions,
    net: row.net,
    expiresAt,
  };
}
/** Sensitive amounts are emitted only by an audited command, never a subscription. */
export const detail = mutationWithOrg({
  args: { requestId: v.string(), rowId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrPayslipRows" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.payslip.reveal",
      requestId: args.requestId,
      payload: { rowId: args.rowId },
      table: "hrPayslipRows",
      replay: async () => revealed(ctx, args.rowId),
      run: async () => {
        const extra = await revealed(ctx, args.rowId);
        if ("written" in extra) return extra;
        return {
          documentId: args.rowId,
          extra,
          changes: [
            { field: "statementId", to: args.rowId },
            { field: "verificationExpiresAt", to: String(extra.expiresAt) },
          ],
        };
      },
    }),
});

export const ticket = mutationWithOrg({
  args: { requestId: v.string(), rowId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrPayslipTickets" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.payslip.download",
      requestId: args.requestId,
      payload: args,
      table: "hrPayslipTickets",
      replay: async (id) => {
        const ticket = await ctx.tenantDb.get<Doc<"hrPayslipTickets">>(
          "hrPayslipTickets",
          id,
        );
        const policy = await policyOf(ctx);
        return ticket &&
          policy &&
          ticket.userId === ctx.tenant.actor._id &&
          ticket.sessionId === ctx.identity.sid &&
          ticket.policyVersionId === policy._id &&
          (await ownedPublished(ctx, ticket.rowId)) &&
          ticket.expiresAt > Date.now() &&
          verifiedExpiry(ctx, policy.config.verificationMinutes)
          ? { expiresAt: ticket.expiresAt }
          : fail("PAYSLIP_TICKET_EXPIRED");
      },
      run: async () => {
        const row = await ownedPublished(ctx, args.rowId);
        if (!row) return fail("NOT_FOUND");
        const policy = await policyOf(ctx);
        if (!policy) return fail("POLICY_NOT_ACTIVE");
        if (!capabilities()) return fail("PAYSLIP_CAPABILITY_UNAVAILABLE");
        const expiry = verifiedExpiry(ctx, policy.config.verificationMinutes);
        if (!expiry) return fail("REVERIFICATION_REQUIRED");
        const issuedAt = Date.now(),
          expiresAt = Math.min(
            expiry,
            issuedAt + policy.config.downloadSeconds * 1000,
          );
        const id = await ctx.tenantDb.insert("hrPayslipTickets", {
          rowId: row._id,
          employeeId: row.employeeId,
          userId: ctx.tenant.actor._id,
          sessionId: String(ctx.identity.sid),
          policyVersionId: policy._id,
          issuedAt,
          expiresAt,
        });
        return {
          documentId: id,
          extra: { expiresAt },
          changes: [{ field: "statementId", to: row._id }],
        };
      },
    }),
});

async function privateDocument(ctx: TenantFunctionContext, ticketId: string) {
  const ticket = await ctx.tenantDb.get<Doc<"hrPayslipTickets">>(
    "hrPayslipTickets",
    ticketId,
  );
  if (
    !ticket ||
    ticket.userId !== ctx.tenant.actor._id ||
    ticket.sessionId !== ctx.identity.sid ||
    ticket.expiresAt <= Date.now()
  )
    return fail("PAYSLIP_TICKET_EXPIRED");
  const row = await ownedPublished(ctx, ticket.rowId);
  const policy = await policyOf(ctx);
  if (!row || !policy) return fail("NOT_FOUND");
  if (!capabilities()) return fail("PAYSLIP_CAPABILITY_UNAVAILABLE");
  if (ticket.policyVersionId !== policy._id)
    return fail("PAYSLIP_TICKET_EXPIRED");
  if (!verifiedExpiry(ctx, policy.config.verificationMinutes))
    return fail("REVERIFICATION_REQUIRED");
  const bytes = pdfBytes(row.sourceBase64);
  if (!bytes || (await pdfHash(bytes)) !== row.sourceHash)
    return fail("PAYSLIP_SOURCE_INTEGRITY_FAILED");
  return {
    base64: row.sourceBase64,
    policyVersionId: policy._id,
    sha256: row.sourceHash,
    expiresAt: ticket.expiresAt,
    fileName: `${row.employeeCode.replace(/[^a-zA-Z0-9_-]/g, "_")}_${row.from}_v${row.version}.pdf`,
  };
}
/** Document delivery is audited and rechecked at every exact retry. */
export const document = mutationWithOrg({
  args: { requestId: v.string(), ticketId: v.string() },
  returns: v.any(),
  permissionCode: SELF,
  target: { table: "hrPayslipTickets" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.payslip.document",
      requestId: args.requestId,
      payload: { ticketId: args.ticketId },
      table: "hrPayslipTickets",
      replay: async () => privateDocument(ctx, args.ticketId),
      run: async () => {
        const extra = await privateDocument(ctx, args.ticketId);
        if ("written" in extra) return extra;
        return {
          documentId: args.ticketId,
          extra,
          changes: [{ field: "downloadTicketId", to: args.ticketId }],
        };
      },
    }),
});
