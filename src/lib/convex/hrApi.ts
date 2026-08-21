import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

type WriteResult = TenantOutcome<MasterDataWriteOutcome>;

export type HrRequestStatus =
  "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface AttendanceDayRow {
  readonly attendanceDayId: string;
  readonly businessDate: string;
  readonly status: string;
  readonly clockInAt?: number;
  readonly breakStartedAt?: number;
  readonly breakMinutes: number;
  readonly clockOutAt?: number;
  readonly lastEventAt: number;
  readonly timezone: string;
}

export interface MyHrPayload {
  readonly found: boolean;
  readonly employee?: {
    readonly employeeId: string;
    readonly employeeNumber: string;
    readonly displayName: string;
    readonly warehouseId: string;
  };
  readonly days?: readonly AttendanceDayRow[];
  readonly corrections?: readonly {
    readonly attendanceCorrectionId: string;
    readonly attendanceDayId: string;
    readonly status: HrRequestStatus;
    readonly reason: string;
    readonly requestedAt: number;
    readonly decisionNote?: string;
  }[];
  readonly leaves?: readonly {
    readonly leaveRequestId: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly leaveType: string;
    readonly durationKind: string;
    readonly hours?: number;
    readonly privateReason?: string;
    readonly status: HrRequestStatus;
    readonly requestedAt: number;
    readonly decisionNote?: string;
  }[];
  readonly complete?: boolean;
  readonly asOf?: number;
}

export interface TeamHrInboxPayload {
  readonly items: readonly {
    readonly requestId: string;
    readonly kind: "CORRECTION" | "LEAVE";
    readonly employeeId: string;
    readonly employeeNumber: string;
    readonly displayName: string;
    readonly requestedAt: number;
    readonly summary: string;
  }[];
  readonly complete: boolean;
  readonly asOf: number;
}

export const readMyHrRef = makeFunctionReference<
  "query",
  Record<string, never>,
  TenantOutcome<MyHrPayload>
>("hr/attendance:readMyHr");

export const listTeamInboxRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<TeamHrInboxPayload>
>("hr/attendance:listTeamInbox");

export const clockRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly kind: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT";
    readonly deviceOccurredAt?: number;
    readonly installationId?: string;
  },
  WriteResult
>("hr/attendance:clock");

export const requestAttendanceCorrectionRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly attendanceDayId: string;
    readonly requestedClockInAt: number;
    readonly requestedClockOutAt: number;
    readonly requestedBreakMinutes: number;
    readonly reason: string;
  },
  WriteResult
>("hr/attendance:requestAttendanceCorrection");

export const requestLeaveRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly leaveType: "ANNUAL" | "SICK" | "PERSONAL" | "UNPAID" | "OTHER";
    readonly durationKind: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURS";
    readonly hours?: number;
    readonly privateReason?: string;
  },
  WriteResult
>("hr/attendance:requestLeave");

export const decideAttendanceCorrectionRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly attendanceCorrectionId: string;
    readonly decision: "APPROVE" | "REJECT";
    readonly note: string;
  },
  WriteResult
>("hr/attendance:decideAttendanceCorrection");

export const decideLeaveRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly leaveRequestId: string;
    readonly decision: "APPROVE" | "REJECT";
    readonly note: string;
  },
  WriteResult
>("hr/attendance:decideLeave");
