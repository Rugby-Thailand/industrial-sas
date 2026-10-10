/**
 * What the HR module may show this member: the HR permissions they hold, the
 * organization's business date and, for reviewers and HR, their sites.
 *
 * This is display information only. Every HR function re-authorizes itself.
 * It is separate from `workspace/current`, which requires storage access, so
 * an HR-only employee can reach the shell without any storage permission.
 */
import { v } from "convex/values";

import { HR_PERMISSION } from "../lib/permissions";
import { queryWithOrg } from "../lib/tenantFunctions";
import {
  heldHrPermissions,
  linkedEmployee,
  orgClock,
  scopedSites,
  siteScope,
} from "./shared";

export const current = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrEmployees" },
  handler: async (ctx) => {
    const permissions = await heldHrPermissions(ctx);
    const clock = orgClock(ctx);
    const privileged = permissions.some(
      (code) => code !== HR_PERMISSION.selfAccess,
    );
    const list = privileged
      ? await scopedSites(ctx, await siteScope(ctx))
      : { sites: [], complete: true };
    const sites = list.sites;
    const employee = await linkedEmployee(ctx);
    return {
      permissions,
      organizationName: ctx.tenant.organization.name,
      timezone: ctx.tenant.organization.settings.timezone,
      timezoneSupported: clock !== null,
      today: clock?.today,
      organizationId: ctx.tenant.organization._id,
      actorUserId: ctx.tenant.actor._id,
      employee:
        employee === null
          ? undefined
          : { code: employee.code, displayName: employee.displayName },
      sitesComplete: list.complete,
      sites: sites.map((site) => ({
        id: site._id,
        code: site.code,
        name: site.name,
      })),
    };
  },
});
