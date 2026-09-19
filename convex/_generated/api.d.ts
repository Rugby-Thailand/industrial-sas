/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as finishedGoods_batchManagement from "../finishedGoods/batchManagement.js";
import type * as finishedGoods_batches from "../finishedGoods/batches.js";
import type * as finishedGoods_catalogue from "../finishedGoods/catalogue.js";
import type * as finishedGoods_catalogueFilters from "../finishedGoods/catalogueFilters.js";
import type * as finishedGoods_summaryMaintenance from "../finishedGoods/summaryMaintenance.js";
import type * as finishedGoods_workflow from "../finishedGoods/workflow.js";
import type * as http from "../http.js";
import type * as lib_authorization from "../lib/authorization.js";
import type * as lib_authorizationLookupsConvex from "../lib/authorizationLookupsConvex.js";
import type * as lib_authorizationSeedConvex from "../lib/authorizationSeedConvex.js";
import type * as lib_cataloguePagination from "../lib/cataloguePagination.js";
import type * as lib_clerkWebhook from "../lib/clerkWebhook.js";
import type * as lib_clerkWebhookNormalizer from "../lib/clerkWebhookNormalizer.js";
import type * as lib_finishedGoodsSummary from "../lib/finishedGoodsSummary.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_identityMirrorConvex from "../lib/identityMirrorConvex.js";
import type * as lib_identityWebhook from "../lib/identityWebhook.js";
import type * as lib_masterDataStore from "../lib/masterDataStore.js";
import type * as lib_navigationGrants from "../lib/navigationGrants.js";
import type * as lib_organizationDefaults from "../lib/organizationDefaults.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_privateFileStorage from "../lib/privateFileStorage.js";
import type * as lib_schemaPolicy from "../lib/schemaPolicy.js";
import type * as lib_signedCatalogueCursor from "../lib/signedCatalogueCursor.js";
import type * as lib_tenantContext from "../lib/tenantContext.js";
import type * as lib_tenantContextLookups from "../lib/tenantContextLookups.js";
import type * as lib_tenantDb from "../lib/tenantDb.js";
import type * as lib_tenantFunctions from "../lib/tenantFunctions.js";
import type * as lib_tenantIndexPolicy from "../lib/tenantIndexPolicy.js";
import type * as lib_tenantStorage from "../lib/tenantStorage.js";
import type * as lib_tenantTable from "../lib/tenantTable.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_writeEnvelope from "../lib/writeEnvelope.js";
import type * as model_authorization_navigationPermissions from "../model/authorization/navigationPermissions.js";
import type * as model_finishedGoods_packing from "../model/finishedGoods/packing.js";
import type * as model_finishedGoods_placement from "../model/finishedGoods/placement.js";
import type * as model_gs1_checkDigit from "../model/gs1/checkDigit.js";
import type * as model_guards from "../model/guards.js";
import type * as model_identifiers_normalization from "../model/identifiers/normalization.js";
import type * as model_inventory_requestIdentity from "../model/inventory/requestIdentity.js";
import type * as model_result from "../model/result.js";
import type * as model_storageLayout_areaUsage from "../model/storageLayout/areaUsage.js";
import type * as model_storageLayout_occupancy from "../model/storageLayout/occupancy.js";
import type * as model_storageLayout_storageLayout from "../model/storageLayout/storageLayout.js";
import type * as model_storageLayout_storagePosition from "../model/storageLayout/storagePosition.js";
import type * as model_storageLayout_storageZone from "../model/storageLayout/storageZone.js";
import type * as staging_annexDemo from "../staging/annexDemo.js";
import type * as staging_paginationDemo from "../staging/paginationDemo.js";
import type * as staging_summaryBackfill from "../staging/summaryBackfill.js";
import type * as storageLayouts_catalogue from "../storageLayouts/catalogue.js";
import type * as storageLayouts_locationCatalogue from "../storageLayouts/locationCatalogue.js";
import type * as storageLayouts_moveOccupancy from "../storageLayouts/moveOccupancy.js";
import type * as storageLayouts_writes from "../storageLayouts/writes.js";
import type * as storageLayouts_zones from "../storageLayouts/zones.js";
import type * as workspace_current from "../workspace/current.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "finishedGoods/batchManagement": typeof finishedGoods_batchManagement;
  "finishedGoods/batches": typeof finishedGoods_batches;
  "finishedGoods/catalogue": typeof finishedGoods_catalogue;
  "finishedGoods/catalogueFilters": typeof finishedGoods_catalogueFilters;
  "finishedGoods/summaryMaintenance": typeof finishedGoods_summaryMaintenance;
  "finishedGoods/workflow": typeof finishedGoods_workflow;
  http: typeof http;
  "lib/authorization": typeof lib_authorization;
  "lib/authorizationLookupsConvex": typeof lib_authorizationLookupsConvex;
  "lib/authorizationSeedConvex": typeof lib_authorizationSeedConvex;
  "lib/cataloguePagination": typeof lib_cataloguePagination;
  "lib/clerkWebhook": typeof lib_clerkWebhook;
  "lib/clerkWebhookNormalizer": typeof lib_clerkWebhookNormalizer;
  "lib/finishedGoodsSummary": typeof lib_finishedGoodsSummary;
  "lib/idempotency": typeof lib_idempotency;
  "lib/identityMirrorConvex": typeof lib_identityMirrorConvex;
  "lib/identityWebhook": typeof lib_identityWebhook;
  "lib/masterDataStore": typeof lib_masterDataStore;
  "lib/navigationGrants": typeof lib_navigationGrants;
  "lib/organizationDefaults": typeof lib_organizationDefaults;
  "lib/permissions": typeof lib_permissions;
  "lib/privateFileStorage": typeof lib_privateFileStorage;
  "lib/schemaPolicy": typeof lib_schemaPolicy;
  "lib/signedCatalogueCursor": typeof lib_signedCatalogueCursor;
  "lib/tenantContext": typeof lib_tenantContext;
  "lib/tenantContextLookups": typeof lib_tenantContextLookups;
  "lib/tenantDb": typeof lib_tenantDb;
  "lib/tenantFunctions": typeof lib_tenantFunctions;
  "lib/tenantIndexPolicy": typeof lib_tenantIndexPolicy;
  "lib/tenantStorage": typeof lib_tenantStorage;
  "lib/tenantTable": typeof lib_tenantTable;
  "lib/validators": typeof lib_validators;
  "lib/writeEnvelope": typeof lib_writeEnvelope;
  "model/authorization/navigationPermissions": typeof model_authorization_navigationPermissions;
  "model/finishedGoods/packing": typeof model_finishedGoods_packing;
  "model/finishedGoods/placement": typeof model_finishedGoods_placement;
  "model/gs1/checkDigit": typeof model_gs1_checkDigit;
  "model/guards": typeof model_guards;
  "model/identifiers/normalization": typeof model_identifiers_normalization;
  "model/inventory/requestIdentity": typeof model_inventory_requestIdentity;
  "model/result": typeof model_result;
  "model/storageLayout/areaUsage": typeof model_storageLayout_areaUsage;
  "model/storageLayout/occupancy": typeof model_storageLayout_occupancy;
  "model/storageLayout/storageLayout": typeof model_storageLayout_storageLayout;
  "model/storageLayout/storagePosition": typeof model_storageLayout_storagePosition;
  "model/storageLayout/storageZone": typeof model_storageLayout_storageZone;
  "staging/annexDemo": typeof staging_annexDemo;
  "staging/paginationDemo": typeof staging_paginationDemo;
  "staging/summaryBackfill": typeof staging_summaryBackfill;
  "storageLayouts/catalogue": typeof storageLayouts_catalogue;
  "storageLayouts/locationCatalogue": typeof storageLayouts_locationCatalogue;
  "storageLayouts/moveOccupancy": typeof storageLayouts_moveOccupancy;
  "storageLayouts/writes": typeof storageLayouts_writes;
  "storageLayouts/zones": typeof storageLayouts_zones;
  "workspace/current": typeof workspace_current;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
