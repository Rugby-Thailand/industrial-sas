/**
 * What the HR module may show this member: the HR permissions they hold, the
 * organization's business date and, for reviewers and HR, their sites.
 *
 * This is display information only. Every HR function re-authorizes itself.
 * It is separate from `workspace/current`, which requires storage access, so
 * an HR-only employee can reach the shell without any storage permission.
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import { queryWithOrg } from "../lib/tenantFunctions";
import {
  HR_MAX_CHUNK,
  containsSearch,
  hrListInput,
  hrPageArgs,
  hrScanPage,
} from "./pagination";
import {
  heldHrPermissions,
  linkedEmployee,
  orgClock,
  scopedSites,
  siteResolver,
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
          : {
              id: employee._id,
              code: employee.code,
              displayName: employee.displayName,
            },
      sitesComplete: list.complete,
      sites: sites.map((site) => ({
        id: site._id,
        code: site.code,
        name: site.name,
      })),
    };
  },
});

/**
 * Site choices for HR filters and forms, a searchable page at a time over
 * every site the actor may see (code or name contains the search). Used
 * when `current.sitesComplete` is false, i.e. the actor's sites exceed the
 * preloaded list. Organization-wide actors page the site index in code
 * order; warehouse-scoped actors page their grants in site ID order. The
 * selected site's label resolves exactly, wherever it sorts.
 */
export const sitesPage = queryWithOrg({
  args: {
    ...hrPageArgs,
    search: v.optional(v.string()),
    includeInactive: v.optional(v.boolean()),
    selectedId: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrEmployees" },
  handler: async (ctx, args) => {
    const input = hrListInput(args);
    if (!input.ok) return input;
    const permissions = await heldHrPermissions(ctx);
    if (!permissions.some((code) => code !== HR_PERMISSION.selfAccess))
      return { ok: false as const, code: "NOT_FOUND" };
    const scope = await siteScope(ctx);
    const activeOnly = args.includeInactive !== true;
    const siteFor = siteResolver(ctx, scope, activeOnly);
    const view = (site: Doc<"warehouses">) => ({
      id: site._id,
      code: site.code,
      name: site.name,
      active: site.status === "ACTIVE",
    });
    const matches = (site: Doc<"warehouses">) =>
      containsSearch(input.search, site.code, site.name);
    const selected =
      args.selectedId === undefined ? null : await siteFor(args.selectedId);
    const criteria = { search: input.search, activeOnly };
    const common = {
      pageSize: input.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      chunk: input.search === "" ? input.pageSize : HR_MAX_CHUNK,
    };
    const page = scope.all
      ? await hrScanPage(ctx, {
          ...common,
          surface: "sites",
          criteria: { ...criteria, order: "code" },
          table: "warehouses",
          lanes: [
            activeOnly
              ? {
                  key: "active",
                  index: "by_orgId_status_code",
                  equality: [{ field: "status", value: "ACTIVE" }],
                }
              : { key: "all", index: "by_orgId_code", equality: [] },
          ],
          match: (site: Doc<"warehouses">) =>
            (!activeOnly || site.status === "ACTIVE") && matches(site),
          hydrate: async (site) => view(site),
        })
      : await hrScanPage(ctx, {
          ...common,
          surface: "sites",
          criteria: { ...criteria, order: "grant" },
          table: "membershipWarehouses",
          lanes: [
            {
              key: "grants",
              index: "by_orgId_membershipId_warehouseId",
              equality: [
                { field: "membershipId", value: ctx.tenant.membership._id },
              ],
            },
          ],
          match: async (grant: Doc<"membershipWarehouses">) => {
            if (grant.membershipId !== ctx.tenant.membership._id) return false;
            const site = await siteFor(grant.warehouseId);
            return site !== null && matches(site);
          },
          hydrate: async (grant) => {
            const site = await siteFor(grant.warehouseId);
            return site === null ? null : view(site);
          },
        });
    return {
      ok: true as const,
      ...page,
      selected: selected === null ? null : view(selected),
    };
  },
});
