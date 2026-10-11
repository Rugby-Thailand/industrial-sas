/**
 * Minimal, scoped HR entity search for the global search dialog and AI
 * navigation.
 *
 * Each query is bound to the permission of the page it opens and returns
 * only what that page may show: reviewers see their reviewable employees
 * (direct reports, or the HR site scope) and never themselves; HR admins see
 * their site scope on active sites, as the editor does. Explicit codes of
 * any schema-valid length (`A`, `12`, `NIGHT`) use the org/code index, one
 * exact read each; a name of two or more characters is a bounded,
 * untruncated substring pilot over the actor's own scope. Nothing reads
 * the organization at large, and out-of-scope matches are indistinguishable
 * from no match. `complete: false` means the bounded read stopped early, so
 * "no match" must not be concluded and the user should narrow the search.
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { isIsoDate } from "../model/hr/calendar";
import { normalizeEmployeeCode } from "../model/hr/employee";
import { MAX_EXACT_CODES, readReferences } from "../model/search/references";
import {
  EMPLOYEE_CODE,
  MAX_SEARCH_TEXT,
  normalizeSearchText,
} from "../model/search/text";
import {
  MAX_SITE_EMPLOYEES,
  inScope,
  reviewBlocker,
  reviewScope,
  scopedSites,
  scopedSitesAnyStatus,
  siteScope,
  type Employee,
  type SiteScope,
} from "./shared";

/** Results shown per query; more matches report `complete: false`. */
export const MAX_SEARCH_RESULTS = 8;
/** Employees a name search may read in one request across all scoped sites. */
export const MAX_NAME_SCAN = 400;
const MIN_NAME_LENGTH = 2;

type Match = "CODE" | "NAME" | "NAME_PREFIX" | "CODE_PREFIX" | "PARTIAL";
const RANK: Readonly<Record<Match, number>> = {
  CODE: 0,
  NAME: 1,
  NAME_PREFIX: 2,
  CODE_PREFIX: 3,
  PARTIAL: 4,
};

export interface EmployeeHit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly siteCode: string;
  readonly active: boolean;
  readonly match: Match;
}

export interface EmployeeSearchResult {
  readonly items: readonly EmployeeHit[];
  /** Every in-scope candidate was compared and no result was cut. */
  readonly complete: boolean;
}

function matchOf(employee: Employee, needle: string): Match | null {
  const code = employee.code.toLowerCase();
  const name = normalizeSearchText(employee.displayName);
  if (code === needle) return "CODE";
  if (name === needle) return "NAME";
  if (name.startsWith(needle)) return "NAME_PREFIX";
  if (code.startsWith(needle)) return "CODE_PREFIX";
  if (name.includes(needle)) return "PARTIAL";
  return null;
}

async function sitesOf(
  ctx: TenantFunctionContext,
  employees: readonly Employee[],
): Promise<ReadonlyMap<string, Doc<"warehouses"> | null>> {
  const sites = new Map<string, Doc<"warehouses"> | null>();
  for (const id of new Set(employees.map((employee) => employee.warehouseId)))
    sites.set(id, await ctx.tenantDb.get<Doc<"warehouses">>("warehouses", id));
  return sites;
}

async function present(
  ctx: TenantFunctionContext,
  matches: readonly { employee: Employee; match: Match }[],
  complete: boolean,
): Promise<EmployeeSearchResult> {
  const sorted = [...matches].sort(
    (a, b) =>
      RANK[a.match] - RANK[b.match] ||
      a.employee.code.localeCompare(b.employee.code),
  );
  const shown = sorted.slice(0, MAX_SEARCH_RESULTS);
  const sites = await sitesOf(
    ctx,
    shown.map((entry) => entry.employee),
  );
  return {
    complete: complete && sorted.length <= MAX_SEARCH_RESULTS,
    items: shown.map(({ employee, match }) => ({
      id: employee._id,
      code: employee.code,
      name: employee.displayName,
      siteCode: sites.get(employee.warehouseId)?.code ?? "",
      active: employee.status === "ACTIVE",
      match,
    })),
  };
}

/**
 * The codes to look up exactly: those the caller lists (AI navigation) or
 * the explicit code tokens of the text, of any schema-valid length.
 * `complete: false` when there were more than one request may look up.
 */
function exactCodes(args: {
  readonly text: string;
  readonly codes?: readonly string[] | undefined;
}): { readonly codes: readonly string[]; readonly complete: boolean } {
  const wanted =
    args.codes === undefined
      ? readReferences(args.text, null).codes
      : args.codes.map(normalizeEmployeeCode);
  const valid = [...new Set(wanted)].filter((code) => EMPLOYEE_CODE.test(code));
  return {
    codes: valid.slice(0, MAX_EXACT_CODES),
    complete: valid.length <= MAX_EXACT_CODES,
  };
}

/** Employees holding exactly these codes (org/code index, one read each). */
async function byExactCode(
  ctx: TenantFunctionContext,
  codes: readonly string[],
): Promise<readonly Employee[]> {
  const found: Employee[] = [];
  for (const code of codes) {
    const employee = await ctx.tenantDb
      .byIndex<Employee>("hrEmployees", "by_orgId_code", [
        { field: "code", value: code },
      ])
      .unique();
    if (employee !== null) found.push(employee);
  }
  return found;
}

/** In-scope employees for a name search, bounded; `complete` when all read. */
async function adminCandidates(
  ctx: TenantFunctionContext,
  scope: SiteScope,
): Promise<{ employees: readonly Employee[]; complete: boolean }> {
  const { sites, complete: sitesComplete } = await scopedSites(ctx, scope);
  const employees: Employee[] = [];
  let complete = sitesComplete;
  for (const site of sites) {
    const budget = MAX_NAME_SCAN - employees.length;
    if (budget <= 0) {
      complete = false;
      break;
    }
    const take = Math.min(MAX_SITE_EMPLOYEES, budget);
    const rows = await ctx.tenantDb
      .byIndex<Employee>("hrEmployees", "by_orgId_warehouseId_code", [
        { field: "warehouseId", value: site._id },
      ])
      .take(take + 1);
    if (rows.length > take) complete = false;
    employees.push(...rows.slice(0, take));
  }
  return { employees, complete };
}

/**
 * The whole normalized text for name comparison, never truncated: a longer
 * name must not match a different person sharing its first characters.
 * Shorter than two characters searches codes only.
 */
function needleOf(text: string): string | null {
  const needle = normalizeSearchText(text);
  return needle.length >= MIN_NAME_LENGTH ? needle : null;
}

const searchArgs = {
  text: v.string(),
  /**
   * Codes to look up exactly instead of reading them from `text`. AI
   * navigation sends only codes (empty `text`), so no name is compared.
   */
  codes: v.optional(v.array(v.string())),
};

/**
 * Exact code hits first, then (for text) the bounded name comparison over
 * `candidates`. Both are already filtered to what the page may open.
 */
async function search(
  ctx: TenantFunctionContext,
  args: { readonly text: string; readonly codes?: readonly string[] },
  visible: (employees: readonly Employee[]) => Promise<readonly Employee[]>,
  candidates: () => Promise<{
    employees: readonly Employee[];
    complete: boolean;
  }>,
): Promise<EmployeeSearchResult> {
  if (
    args.text.length > MAX_SEARCH_TEXT ||
    (args.codes !== undefined && args.codes.length > MAX_SEARCH_TEXT)
  )
    return { items: [], complete: false };
  const lookup = exactCodes(args);
  const exact = await visible(await byExactCode(ctx, lookup.codes));
  const matches = exact.map((employee) => ({
    employee,
    match: "CODE" as Match,
  }));
  const needle = needleOf(args.text);
  if (needle === null) return await present(ctx, matches, lookup.complete);
  const seen = new Set(exact.map((employee) => employee._id));
  const scan = await candidates();
  for (const employee of await visible(scan.employees)) {
    if (seen.has(employee._id)) continue;
    const match = matchOf(employee, needle);
    if (match !== null) matches.push({ employee, match });
  }
  return await present(ctx, matches, lookup.complete && scan.complete);
}

/**
 * Employees the actor may review: direct reports for a supervisor, the site
 * scope for HR. The actor's own record is excluded (no self-review). The
 * review page opens any of them (`review.dayDetail` applies the same rule).
 */
export const reviewEmployees = queryWithOrg({
  args: searchArgs,
  returns: v.any(),
  permissionCode: HR_PERMISSION.teamReview,
  target: { table: "hrEmployees" },
  handler: async (ctx, args): Promise<EmployeeSearchResult> => {
    const scope = await reviewScope(ctx);
    return await search(
      ctx,
      args,
      async (employees) =>
        employees.filter((employee) => reviewBlocker(scope, employee) === null),
      async () => {
        if (scope.admin) return await adminCandidates(ctx, scope.sites);
        const rows = await ctx.tenantDb
          .byIndex<Employee>("hrEmployees", "by_orgId_supervisorUserId", [
            { field: "supervisorUserId", value: scope.actorUserId },
          ])
          .take(MAX_SITE_EMPLOYEES + 1);
        return {
          employees: rows.slice(0, MAX_SITE_EMPLOYEES),
          complete: rows.length <= MAX_SITE_EMPLOYEES && scope.sites.complete,
        };
      },
    );
  },
});

/**
 * Employees an HR administrator may edit: in their site scope and on an
 * active site, exactly the records `setup.employee` opens in the editor.
 */
export const adminEmployees = queryWithOrg({
  args: searchArgs,
  returns: v.any(),
  permissionCode: HR_PERMISSION.adminManage,
  target: { table: "hrEmployees" },
  handler: async (ctx, args): Promise<EmployeeSearchResult> => {
    const scope = await siteScope(ctx);
    return await search(
      ctx,
      args,
      async (employees) => {
        const inside = employees.filter((employee) =>
          inScope(scope, employee.warehouseId),
        );
        const sites = await sitesOf(ctx, inside);
        return inside.filter(
          (employee) => sites.get(employee.warehouseId)?.status === "ACTIVE",
        );
      },
      async () => await adminCandidates(ctx, scope),
    );
  },
});

/** Periods with exactly this date range in the actor's site scope. */
export const periodsByRange = queryWithOrg({
  args: { from: v.string(), to: v.string() },
  returns: v.any(),
  permissionCode: HR_PERMISSION.periodClose,
  target: { table: "hrPeriods" },
  handler: async (ctx, args) => {
    if (!isIsoDate(args.from) || !isIsoDate(args.to))
      return { items: [], complete: true };
    const list = await scopedSitesAnyStatus(ctx, await siteScope(ctx));
    let complete = list.complete;
    const items = [];
    for (const site of list.sites) {
      const periods = await ctx.tenantDb
        .byIndex<Doc<"hrPeriods">>(
          "hrPeriods",
          "by_orgId_warehouseId_startDate",
          [
            { field: "warehouseId", value: site._id },
            { field: "startDate", value: args.from },
          ],
        )
        // Periods of one site never overlap (`create` refuses it), so one
        // start date has at most one period; a second row means the
        // invariant broke and the answer is reported incomplete.
        .take(2);
      if (periods.length > 1) complete = false;
      for (const period of periods)
        if (period.endDate === args.to)
          items.push({
            id: period._id,
            siteCode: site.code,
            siteName: site.name,
            startDate: period.startDate,
            endDate: period.endDate,
            status: period.status,
            latestClosedVersion: period.latestClosedVersion,
          });
    }
    return { items, complete };
  },
});
