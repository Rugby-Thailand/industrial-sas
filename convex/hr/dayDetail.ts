/** One employee business date as shown in personal history and review. */
import type { Doc } from "../_generated/dataModel";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { evaluateDay, certificationIsCurrent } from "../model/hr/attendance";
import type { IsoDate } from "../model/hr/calendar";
import {
  closedPeriodCovering,
  dayOf,
  livePlan,
  memberName,
  planFromStored,
  planView,
  type Employee,
  type OrgClock,
} from "./shared";

type Correction = Doc<"hrCorrectionRequests">;

export const MAX_DAY_EVENTS = 20;
export const MAX_DAY_CORRECTIONS = 20;

export interface DayCorrections {
  readonly items: readonly Correction[];
  /** False when older requests exist beyond the newest `MAX_DAY_CORRECTIONS`. */
  readonly complete: boolean;
}

/**
 * The newest correction requests of a day, newest submission first. The
 * pending request is always included even if it was created long ago and
 * resubmitted; older requests beyond the bound are reported, not hidden.
 */
export async function dayCorrections(
  ctx: TenantFunctionContext,
  day: Pick<Doc<"hrAttendanceDays">, "_id" | "pendingCorrectionId">,
): Promise<DayCorrections> {
  const rows = await ctx.tenantDb
    .byIndex<Correction>("hrCorrectionRequests", "by_orgId_dayId_submittedAt", [
      { field: "dayId", value: day._id },
    ])
    .take(MAX_DAY_CORRECTIONS + 1, "desc");
  const items = rows.slice(0, MAX_DAY_CORRECTIONS);
  if (
    day.pendingCorrectionId !== undefined &&
    !items.some((item) => item._id === day.pendingCorrectionId)
  ) {
    const pending = await ctx.tenantDb.get<Correction>(
      "hrCorrectionRequests",
      day.pendingCorrectionId,
    );
    if (pending !== null) items.unshift(pending);
  }
  return {
    items: [...items].sort((a, b) => b.submittedAt - a.submittedAt),
    complete: rows.length <= MAX_DAY_CORRECTIONS,
  };
}

export async function correctionView(
  ctx: TenantFunctionContext,
  correction: Correction,
  dayRevision: number,
  names: Map<string, string | null>,
) {
  return {
    id: correction._id,
    status: correction.status,
    proposedStartAt: correction.proposedStartAt,
    proposedEndAt: correction.proposedEndAt,
    reason: correction.reason,
    version: correction.version,
    stale: correction.baseRevision !== dayRevision,
    submittedAt: correction.submittedAt,
    submittedByName: await memberName(ctx, correction.submittedByUserId, names),
    decidedAt: correction.decidedAt,
    decidedByName: await memberName(ctx, correction.decidedByUserId, names),
    decisionReason: correction.decisionReason,
    history: await Promise.all(
      correction.history.map(async (entry) => ({
        action: entry.action,
        at: entry.at,
        actorName: await memberName(ctx, entry.actorUserId, names),
        reason: entry.reason,
        proposedStartAt: entry.proposedStartAt,
        proposedEndAt: entry.proposedEndAt,
      })),
    ),
  };
}

export async function buildDayDetail(
  ctx: TenantFunctionContext,
  employee: Employee,
  date: IsoDate,
  clock: OrgClock,
) {
  const names = new Map<string, string | null>();
  const day = await dayOf(ctx, employee._id, date);
  const plan = day
    ? planFromStored(day.plan)
    : await livePlan(ctx, employee, date, clock.offset);
  const evaluation = evaluateDay({
    plan,
    now: clock.now,
    revision: day?.revision ?? 0,
    clockInAt: day?.clockInAt,
    clockOutAt: day?.clockOutAt,
    certification: day?.certification,
    pendingCorrection: day?.pendingCorrectionId !== undefined,
  });
  const events = day
    ? await ctx.tenantDb
        .byIndex<Doc<"hrAttendanceEvents">>(
          "hrAttendanceEvents",
          "by_orgId_dayId",
          [{ field: "dayId", value: day._id }],
        )
        .take(MAX_DAY_EVENTS)
    : [];
  const corrections = day
    ? await dayCorrections(ctx, day)
    : { items: [], complete: true };
  const certification = day?.certification;
  return {
    employeeId: employee._id,
    businessDate: date,
    revision: day?.revision ?? 0,
    plan: planView(plan),
    status: evaluation.status,
    issue: evaluation.issue,
    disposition: evaluation.disposition,
    effectiveStartAt: evaluation.effectiveStartAt,
    effectiveEndAt: evaluation.effectiveEndAt,
    workedMinutes: evaluation.workedMinutes,
    outsideShiftMinutes: evaluation.outsideShiftMinutes,
    originalStartAt: day?.clockInAt,
    originalEndAt: day?.clockOutAt,
    locked:
      (await closedPeriodCovering(ctx, employee.warehouseId, date)) !== null,
    events: await Promise.all(
      [...events]
        .sort((a, b) => a.occurredAt - b.occurredAt)
        .map(async (event) => ({
          kind: event.kind,
          occurredAt: event.occurredAt,
          source: event.source,
          actorName: await memberName(ctx, event.actorUserId, names),
        })),
    ),
    certification:
      certification === undefined
        ? undefined
        : {
            disposition: certification.disposition,
            startAt: certification.startAt,
            endAt: certification.endAt,
            reason: certification.reason,
            decidedAt: certification.decidedAt,
            decidedByName: await memberName(
              ctx,
              certification.decidedByUserId,
              names,
            ),
            current: certificationIsCurrent(certification, day?.revision ?? 0),
          },
    pendingCorrectionId: day?.pendingCorrectionId,
    ...(day?.certificationHistory?.length
      ? {
          priorCertifications: await Promise.all(
            [...day.certificationHistory].reverse().map(async (entry) => ({
              disposition: entry.disposition,
              startAt: entry.startAt,
              endAt: entry.endAt,
              reason: entry.reason,
              decidedAt: entry.decidedAt,
              decidedByName: await memberName(
                ctx,
                entry.decidedByUserId,
                names,
              ),
            })),
          ),
        }
      : {}),
    ...(corrections.complete ? {} : { correctionsIncomplete: true as const }),
    corrections: await Promise.all(
      corrections.items.map((correction) =>
        correctionView(ctx, correction, day?.revision ?? 0, names),
      ),
    ),
  };
}
