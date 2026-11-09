import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as self from "../../convex/hr/self";
import * as leave from "../../convex/hr/leave";
import * as policies from "../../convex/hr/policies";
import * as periods from "../../convex/hr/periods";
import * as periodClose from "../../convex/hr/periodClose";
import * as setup from "../../convex/hr/setup";
import { fromLocal } from "../../convex/model/hr/calendar";
import { thailandDefaults } from "../../convex/model/hr/policy";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Answer = Record<string, any>;
type Handler = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const EMPLOYEE = { subject: "user_time_probe", org_id: "org_fixture_a" };
let seq = 0;
const rid = () => `period-pending-leave-${++seq}`;
const now = (date: string, minute: number) =>
  vi.setSystemTime(fromLocal(date, minute, 420));
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: object,
  identity = ADMIN,
): Promise<Answer> {
  const outcome = (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Handler)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Answer;
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value;
}
function written(answer: Answer) {
  expect(answer.written, JSON.stringify(answer)).toBe(true);
  return answer;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  now("2026-10-12", 600);
});
afterEach(() => vi.useRealTimers());

it.each([
  { mode: "complete-preview", status: "PENDING" },
  { mode: "staged", status: "PENDING" },
  { mode: "complete-preview", status: "CANCELLATION_REQUESTED" },
  { mode: "staged", status: "CANCELLATION_REQUESTED" },
])(
  "does not publish an attendance period with unresolved leave ($mode, $status)",
  async ({ mode, status }) => {
    const world = await createConvexTenantWorld();
    const auth = await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
    const employeeUserId = await world.t.run(async (ctx) => {
      await ctx.db.patch("memberships", auth.identities.membershipA, {
        scopeMode: "ORG_WIDE",
      });
      const userId = await ctx.db.insert("users", {
        clerkUserId: EMPLOYEE.subject,
        displayName: "Time probe",
        status: "ACTIVE",
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: world.orgA,
        userId,
        clerkMembershipId: "orgmem_time_probe",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
      await ctx.db.insert("membershipRoles", {
        orgId: world.orgA,
        membershipId,
        roleId: auth.rolesA.get("HR_EMPLOYEE")!,
        grantedAt: 0,
      });
      for (const date of [
        "2026-01-01",
        "2026-01-02",
        "2026-02-02",
        "2026-03-02",
        "2026-04-06",
        "2026-04-13",
        "2026-04-14",
        "2026-04-15",
        "2026-05-01",
        "2026-05-04",
        "2026-06-03",
        "2026-07-28",
        "2026-08-12",
      ])
        await ctx.db.insert("hrHolidays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          date,
          name: "Company holiday",
          createdAt: 1,
          createdByUserId: world.userA,
        });
      return userId;
    });
    const employee = written(
      await call(world, setup.saveEmployee, {
        requestId: rid(),
        warehouseId: world.warehouses.alphaA,
        code: "A-PENDING1",
        displayName: "Time probe",
        userId: employeeUserId,
        supervisorUserId: world.userA,
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: "08:30",
          endTime: "17:30",
          endsNextDay: false,
          breakMinutes: 60,
        },
      }),
    );
    written(
      await call(world, policies.saveDraft, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 0,
        effectiveDate: "2026-10-12",
        config: thailandDefaults(),
      }),
    );
    for (const [type, granted] of [
      ["ANNUAL", 6],
      ["SICK", 30],
      ["PERSONAL", 3],
      ["MILITARY", 60],
    ])
      written(
        await call(world, policies.reconcileOpening, {
          requestId: rid(),
          employeeId: employee.documentId,
          type,
          asOf: "2026-10-12",
          granted,
          used: 0,
          reserved: 0,
          paidUsed: 0,
          paidReserved: 0,
          sourceReference: "Signed HR source register",
          expectedVersion: 0,
        }),
      );
    written(
      await call(world, policies.activate, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 1,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
    );
    const draft = {
      type: "ANNUAL",
      from: "2026-10-13",
      to: "2026-10-13",
      reason: "One annual leave day",
    };
    const preview = await call(world, leave.preview, draft, EMPLOYEE);
    expect(preview.ok, JSON.stringify(preview)).toBe(true);
    const request = written(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          expectedPreviewHash: preview.previewHash,
          ...draft,
        },
        EMPLOYEE,
      ),
    );

    if (status === "CANCELLATION_REQUESTED") {
      written(
        await call(world, leave.decide, {
          requestId: rid(),
          leaveRequestId: request.documentId,
          expectedVersion: 1,
          decision: "APPROVE",
        }),
      );
      written(
        await call(
          world,
          leave.cancel,
          {
            requestId: rid(),
            leaveRequestId: request.documentId,
            expectedVersion: 2,
          },
          EMPLOYEE,
        ),
      );
    } else {
      // The employee works while the request is still awaiting a decision.
      // These are ordinary accepted public commands, not seeded attendance.
      now("2026-10-13", 510);
      written(
        await call(
          world,
          self.clockIn,
          { requestId: rid(), expectedBusinessDate: "2026-10-13" },
          EMPLOYEE,
        ),
      );
      now("2026-10-13", 1050);
      written(
        await call(
          world,
          self.clockOut,
          { requestId: rid(), expectedBusinessDate: "2026-10-13" },
          EMPLOYEE,
        ),
      );
    }
    now("2026-10-14", 600);
    if (mode === "staged")
      await world.t.run(async (ctx) => {
        for (let index = 0; index < 50; index++)
          await ctx.db.insert("hrEmployees", {
            orgId: world.orgA,
            warehouseId: world.warehouses.alphaA,
            code: `E${String(index).padStart(4, "0")}`,
            displayName: `Unscheduled employee ${index}`,
            employmentStartDate: "2020-01-01",
            status: "ACTIVE",
            version: 1,
            createdAt: 1,
            updatedAt: 1,
            createdByUserId: world.userA,
            updatedByUserId: world.userA,
          });
      });
    const period = written(
      await call(world, periods.create, {
        requestId: rid(),
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-10-13",
        endDate: "2026-10-13",
      }),
    );
    const attendancePreview = await call(world, periods.preview, {
      periodId: period.documentId,
    });
    if (mode === "complete-preview")
      expect(attendancePreview.view.blocker).toBe("PERIOD_NOT_READY");
    const employeePage = await call(world, periods.draftEmployeesPage, {
      periodId: period.documentId,
      pageSize: 50,
    });
    expect(
      employeePage.page.find(
        (row: Answer) => row.employeeId === employee.documentId,
      )?.rows[0]?.status,
    ).toBe("EXCEPTION");
    let close = await call(world, periodClose.begin, {
      requestId: rid(),
      periodId: period.documentId,
      ...(mode === "complete-preview"
        ? { expectedFingerprint: attendancePreview.view.fingerprint }
        : {}),
    });
    if (mode === "staged")
      for (let guard = 0; guard < 10; guard++) {
        const view = (
          await call(world, periods.preview, { periodId: period.documentId })
        ).view;
        if (view.kind !== "CLOSING") break;
        if (view.state === "READY") {
          close = await call(world, periodClose.publish, {
            requestId: rid(),
            periodId: period.documentId,
            versionId: view.versionId,
            expectedFingerprint: view.fingerprint,
          });
          break;
        }
        written(
          await call(world, periodClose.advance, {
            requestId: rid(),
            periodId: period.documentId,
            versionId: view.versionId,
            step: view.step,
          }),
        );
      }
    const state = await world.t.run(async (ctx) => ({
      requests: await ctx.db.query("hrLeaveRequests").collect(),
      versions: await ctx.db.query("hrPeriodVersions").collect(),
      accounts: await ctx.db.query("hrLeaveAccounts").collect(),
    }));
    expect(
      state.requests.find((row) => row._id === request.documentId)?.status,
    ).toBe(status);
    expect(
      state.accounts.find((row) => row.type === "ANNUAL")?.[
        status === "PENDING" ? "reserved" : "used"
      ],
    ).toBe(1);
    // HR-041: unresolved requests block publication even with ready attendance.
    const published = state.versions.filter((row) => row.build === undefined);
    expect(
      published.length,
      JSON.stringify({
        close,
        blocker: attendancePreview.view.blocker,
        totals: published[0]?.totals,
      }),
    ).toBe(0);
    expect(
      (
        await call(world, periods.preview, {
          periodId: period.documentId,
        })
      ).period.status,
    ).toBe("DRAFT");
    // Resolving the outstanding request releases the close blocker. Approved
    // leave remains claimed, so this also verifies that claims alone do not block.
    if (status === "PENDING") {
      written(
        await call(
          world,
          leave.cancel,
          {
            requestId: rid(),
            leaveRequestId: request.documentId,
            expectedVersion: 1,
          },
          EMPLOYEE,
        ),
      );
    } else {
      written(
        await call(world, leave.decide, {
          requestId: rid(),
          leaveRequestId: request.documentId,
          expectedVersion: 3,
          decision: "KEEP",
          reason: "Keep the approved leave day",
        }),
      );
    }
    const resolved = await call(world, periods.draftEmployeesPage, {
      periodId: period.documentId,
      pageSize: 50,
    });
    expect(
      resolved.page.find(
        (row: Answer) => row.employeeId === employee.documentId,
      )?.rows[0]?.status,
    ).toBe("READY");
    if (mode === "complete-preview")
      expect(
        (
          await call(world, periods.preview, {
            periodId: period.documentId,
          })
        ).view.blocker,
      ).toBeNull();
  },
);
