/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as engineering_changeImpacts from "../engineering/changeImpacts.js";
import type * as engineering_designRequests from "../engineering/designRequests.js";
import type * as engineering_files from "../engineering/files.js";
import type * as engineering_masterCardImports from "../engineering/masterCardImports.js";
import type * as engineering_masterCards from "../engineering/masterCards.js";
import type * as engineering_requirements from "../engineering/requirements.js";
import type * as fulfillment_delivery from "../fulfillment/delivery.js";
import type * as fulfillment_orders from "../fulfillment/orders.js";
import type * as fulfillment_pickExecution from "../fulfillment/pickExecution.js";
import type * as fulfillment_pickPlanning from "../fulfillment/pickPlanning.js";
import type * as fulfillment_reservations from "../fulfillment/reservations.js";
import type * as fulfillment_shipments from "../fulfillment/shipments.js";
import type * as fulfillment_transportFiles from "../fulfillment/transportFiles.js";
import type * as fulfillment_tripExecution from "../fulfillment/tripExecution.js";
import type * as fulfillment_tripPlanning from "../fulfillment/tripPlanning.js";
import type * as hr_attendance from "../hr/attendance.js";
import type * as http from "../http.js";
import type * as integrations_delivery from "../integrations/delivery.js";
import type * as inventory_countExecution from "../inventory/countExecution.js";
import type * as inventory_countPlans from "../inventory/countPlans.js";
import type * as inventory_jobs from "../inventory/jobs.js";
import type * as inventory_ledger from "../inventory/ledger.js";
import type * as inventory_openingStock from "../inventory/openingStock.js";
import type * as labels_print from "../labels/print.js";
import type * as lib_authorization from "../lib/authorization.js";
import type * as lib_authorizationLookupsConvex from "../lib/authorizationLookupsConvex.js";
import type * as lib_authorizationSeedConvex from "../lib/authorizationSeedConvex.js";
import type * as lib_clerkWebhook from "../lib/clerkWebhook.js";
import type * as lib_clerkWebhookNormalizer from "../lib/clerkWebhookNormalizer.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_identityMirrorConvex from "../lib/identityMirrorConvex.js";
import type * as lib_identityWebhook from "../lib/identityWebhook.js";
import type * as lib_inventoryLedgerStore from "../lib/inventoryLedgerStore.js";
import type * as lib_itemScanResolution from "../lib/itemScanResolution.js";
import type * as lib_listEnvelope from "../lib/listEnvelope.js";
import type * as lib_masterDataStore from "../lib/masterDataStore.js";
import type * as lib_organizationDefaults from "../lib/organizationDefaults.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_privateFileDownload from "../lib/privateFileDownload.js";
import type * as lib_privateFileStorage from "../lib/privateFileStorage.js";
import type * as lib_privateFileUpload from "../lib/privateFileUpload.js";
import type * as lib_rollupStore from "../lib/rollupStore.js";
import type * as lib_schemaPolicy from "../lib/schemaPolicy.js";
import type * as lib_taskFileComplete from "../lib/taskFileComplete.js";
import type * as lib_tenantContext from "../lib/tenantContext.js";
import type * as lib_tenantContextLookups from "../lib/tenantContextLookups.js";
import type * as lib_tenantDb from "../lib/tenantDb.js";
import type * as lib_tenantFunctions from "../lib/tenantFunctions.js";
import type * as lib_tenantIndexPolicy from "../lib/tenantIndexPolicy.js";
import type * as lib_tenantStorage from "../lib/tenantStorage.js";
import type * as lib_tenantTable from "../lib/tenantTable.js";
import type * as lib_transportFileComplete from "../lib/transportFileComplete.js";
import type * as lib_uploadThingComplete from "../lib/uploadThingComplete.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_writeEnvelope from "../lib/writeEnvelope.js";
import type * as masterData_catalogue from "../masterData/catalogue.js";
import type * as masterData_writes from "../masterData/writes.js";
import type * as model_counting_countLifecycle from "../model/counting/countLifecycle.js";
import type * as model_counting_openingStock from "../model/counting/openingStock.js";
import type * as model_counting_reconciliationPolicy from "../model/counting/reconciliationPolicy.js";
import type * as model_fulfillment_demandRouting from "../model/fulfillment/demandRouting.js";
import type * as model_fulfillment_pickingPolicy from "../model/fulfillment/pickingPolicy.js";
import type * as model_fulfillment_reservationPolicy from "../model/fulfillment/reservationPolicy.js";
import type * as model_fulfillment_transportPolicy from "../model/fulfillment/transportPolicy.js";
import type * as model_gs1_checkDigit from "../model/gs1/checkDigit.js";
import type * as model_gs1_date from "../model/gs1/date.js";
import type * as model_gs1_elementString from "../model/gs1/elementString.js";
import type * as model_guards from "../model/guards.js";
import type * as model_hr_attendance from "../model/hr/attendance.js";
import type * as model_identifiers_lpn from "../model/identifiers/lpn.js";
import type * as model_identifiers_normalization from "../model/identifiers/normalization.js";
import type * as model_identifiers_scanResolution from "../model/identifiers/scanResolution.js";
import type * as model_inbound_labelPayload from "../model/inbound/labelPayload.js";
import type * as model_inbound_poImport from "../model/inbound/poImport.js";
import type * as model_inbound_putawayScoring from "../model/inbound/putawayScoring.js";
import type * as model_inbound_qcPolicy from "../model/inbound/qcPolicy.js";
import type * as model_inbound_receiptPolicy from "../model/inbound/receiptPolicy.js";
import type * as model_integrations_delivery from "../model/integrations/delivery.js";
import type * as model_inventory_balanceProjection from "../model/inventory/balanceProjection.js";
import type * as model_inventory_expiryReclassification from "../model/inventory/expiryReclassification.js";
import type * as model_inventory_jobPage from "../model/inventory/jobPage.js";
import type * as model_inventory_jobRun from "../model/inventory/jobRun.js";
import type * as model_inventory_ledgerTransaction from "../model/inventory/ledgerTransaction.js";
import type * as model_inventory_requestIdentity from "../model/inventory/requestIdentity.js";
import type * as model_inventory_reversal from "../model/inventory/reversal.js";
import type * as model_inventory_stockIdentity from "../model/inventory/stockIdentity.js";
import type * as model_masterData_catalogueRules from "../model/masterData/catalogueRules.js";
import type * as model_orderToShip_customerOrder from "../model/orderToShip/customerOrder.js";
import type * as model_orderToShip_designReadiness from "../model/orderToShip/designReadiness.js";
import type * as model_orderToShip_designRequest from "../model/orderToShip/designRequest.js";
import type * as model_orderToShip_designSpecification from "../model/orderToShip/designSpecification.js";
import type * as model_orderToShip_factoryPacket from "../model/orderToShip/factoryPacket.js";
import type * as model_orderToShip_masterCardFile from "../model/orderToShip/masterCardFile.js";
import type * as model_orderToShip_masterCardImport from "../model/orderToShip/masterCardImport.js";
import type * as model_orderToShip_masterCardRelease from "../model/orderToShip/masterCardRelease.js";
import type * as model_orderToShip_masterCardRevision from "../model/orderToShip/masterCardRevision.js";
import type * as model_orderToShip_orderImport from "../model/orderToShip/orderImport.js";
import type * as model_platform_commandClassification from "../model/platform/commandClassification.js";
import type * as model_platform_deviceRegistry from "../model/platform/deviceRegistry.js";
import type * as model_platform_quantityEntry from "../model/platform/quantityEntry.js";
import type * as model_platform_stepUp from "../model/platform/stepUp.js";
import type * as model_platform_taskAssignment from "../model/platform/taskAssignment.js";
import type * as model_production_productionExecution from "../model/production/productionExecution.js";
import type * as model_reporting_csv from "../model/reporting/csv.js";
import type * as model_reporting_exportCursor from "../model/reporting/exportCursor.js";
import type * as model_reporting_occupancy from "../model/reporting/occupancy.js";
import type * as model_reporting_operationalViews from "../model/reporting/operationalViews.js";
import type * as model_reporting_rollup from "../model/reporting/rollup.js";
import type * as model_result from "../model/result.js";
import type * as model_rotation_stockRotation from "../model/rotation/stockRotation.js";
import type * as model_storageLayout_storageLayout from "../model/storageLayout/storageLayout.js";
import type * as model_storageLayout_storageZone from "../model/storageLayout/storageZone.js";
import type * as model_time_businessDate from "../model/time/businessDate.js";
import type * as model_transfer_transferPolicy from "../model/transfer/transferPolicy.js";
import type * as model_uom_itemUom from "../model/uom/itemUom.js";
import type * as model_uom_quantity from "../model/uom/quantity.js";
import type * as model_uom_ratio from "../model/uom/ratio.js";
import type * as platform_devices from "../platform/devices.js";
import type * as platform_exceptions from "../platform/exceptions.js";
import type * as platform_stepUp from "../platform/stepUp.js";
import type * as platform_taskFiles from "../platform/taskFiles.js";
import type * as platform_tasks from "../platform/tasks.js";
import type * as production_orders from "../production/orders.js";
import type * as production_packets from "../production/packets.js";
import type * as purchasing_orders from "../purchasing/orders.js";
import type * as putaway_tasks from "../putaway/tasks.js";
import type * as quality_inspections from "../quality/inspections.js";
import type * as receiving_receipts from "../receiving/receipts.js";
import type * as reporting_dashboard from "../reporting/dashboard.js";
import type * as reporting_exports from "../reporting/exports.js";
import type * as reporting_operationalViews from "../reporting/operationalViews.js";
import type * as reporting_rollups from "../reporting/rollups.js";
import type * as sales_customers from "../sales/customers.js";
import type * as sales_orders from "../sales/orders.js";
import type * as storageLayouts_catalogue from "../storageLayouts/catalogue.js";
import type * as storageLayouts_writes from "../storageLayouts/writes.js";
import type * as storageLayouts_zones from "../storageLayouts/zones.js";
import type * as transfers_requests from "../transfers/requests.js";
import type * as workspace_current from "../workspace/current.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "engineering/changeImpacts": typeof engineering_changeImpacts;
  "engineering/designRequests": typeof engineering_designRequests;
  "engineering/files": typeof engineering_files;
  "engineering/masterCardImports": typeof engineering_masterCardImports;
  "engineering/masterCards": typeof engineering_masterCards;
  "engineering/requirements": typeof engineering_requirements;
  "fulfillment/delivery": typeof fulfillment_delivery;
  "fulfillment/orders": typeof fulfillment_orders;
  "fulfillment/pickExecution": typeof fulfillment_pickExecution;
  "fulfillment/pickPlanning": typeof fulfillment_pickPlanning;
  "fulfillment/reservations": typeof fulfillment_reservations;
  "fulfillment/shipments": typeof fulfillment_shipments;
  "fulfillment/transportFiles": typeof fulfillment_transportFiles;
  "fulfillment/tripExecution": typeof fulfillment_tripExecution;
  "fulfillment/tripPlanning": typeof fulfillment_tripPlanning;
  "hr/attendance": typeof hr_attendance;
  http: typeof http;
  "integrations/delivery": typeof integrations_delivery;
  "inventory/countExecution": typeof inventory_countExecution;
  "inventory/countPlans": typeof inventory_countPlans;
  "inventory/jobs": typeof inventory_jobs;
  "inventory/ledger": typeof inventory_ledger;
  "inventory/openingStock": typeof inventory_openingStock;
  "labels/print": typeof labels_print;
  "lib/authorization": typeof lib_authorization;
  "lib/authorizationLookupsConvex": typeof lib_authorizationLookupsConvex;
  "lib/authorizationSeedConvex": typeof lib_authorizationSeedConvex;
  "lib/clerkWebhook": typeof lib_clerkWebhook;
  "lib/clerkWebhookNormalizer": typeof lib_clerkWebhookNormalizer;
  "lib/idempotency": typeof lib_idempotency;
  "lib/identityMirrorConvex": typeof lib_identityMirrorConvex;
  "lib/identityWebhook": typeof lib_identityWebhook;
  "lib/inventoryLedgerStore": typeof lib_inventoryLedgerStore;
  "lib/itemScanResolution": typeof lib_itemScanResolution;
  "lib/listEnvelope": typeof lib_listEnvelope;
  "lib/masterDataStore": typeof lib_masterDataStore;
  "lib/organizationDefaults": typeof lib_organizationDefaults;
  "lib/permissions": typeof lib_permissions;
  "lib/privateFileDownload": typeof lib_privateFileDownload;
  "lib/privateFileStorage": typeof lib_privateFileStorage;
  "lib/privateFileUpload": typeof lib_privateFileUpload;
  "lib/rollupStore": typeof lib_rollupStore;
  "lib/schemaPolicy": typeof lib_schemaPolicy;
  "lib/taskFileComplete": typeof lib_taskFileComplete;
  "lib/tenantContext": typeof lib_tenantContext;
  "lib/tenantContextLookups": typeof lib_tenantContextLookups;
  "lib/tenantDb": typeof lib_tenantDb;
  "lib/tenantFunctions": typeof lib_tenantFunctions;
  "lib/tenantIndexPolicy": typeof lib_tenantIndexPolicy;
  "lib/tenantStorage": typeof lib_tenantStorage;
  "lib/tenantTable": typeof lib_tenantTable;
  "lib/transportFileComplete": typeof lib_transportFileComplete;
  "lib/uploadThingComplete": typeof lib_uploadThingComplete;
  "lib/validators": typeof lib_validators;
  "lib/writeEnvelope": typeof lib_writeEnvelope;
  "masterData/catalogue": typeof masterData_catalogue;
  "masterData/writes": typeof masterData_writes;
  "model/counting/countLifecycle": typeof model_counting_countLifecycle;
  "model/counting/openingStock": typeof model_counting_openingStock;
  "model/counting/reconciliationPolicy": typeof model_counting_reconciliationPolicy;
  "model/fulfillment/demandRouting": typeof model_fulfillment_demandRouting;
  "model/fulfillment/pickingPolicy": typeof model_fulfillment_pickingPolicy;
  "model/fulfillment/reservationPolicy": typeof model_fulfillment_reservationPolicy;
  "model/fulfillment/transportPolicy": typeof model_fulfillment_transportPolicy;
  "model/gs1/checkDigit": typeof model_gs1_checkDigit;
  "model/gs1/date": typeof model_gs1_date;
  "model/gs1/elementString": typeof model_gs1_elementString;
  "model/guards": typeof model_guards;
  "model/hr/attendance": typeof model_hr_attendance;
  "model/identifiers/lpn": typeof model_identifiers_lpn;
  "model/identifiers/normalization": typeof model_identifiers_normalization;
  "model/identifiers/scanResolution": typeof model_identifiers_scanResolution;
  "model/inbound/labelPayload": typeof model_inbound_labelPayload;
  "model/inbound/poImport": typeof model_inbound_poImport;
  "model/inbound/putawayScoring": typeof model_inbound_putawayScoring;
  "model/inbound/qcPolicy": typeof model_inbound_qcPolicy;
  "model/inbound/receiptPolicy": typeof model_inbound_receiptPolicy;
  "model/integrations/delivery": typeof model_integrations_delivery;
  "model/inventory/balanceProjection": typeof model_inventory_balanceProjection;
  "model/inventory/expiryReclassification": typeof model_inventory_expiryReclassification;
  "model/inventory/jobPage": typeof model_inventory_jobPage;
  "model/inventory/jobRun": typeof model_inventory_jobRun;
  "model/inventory/ledgerTransaction": typeof model_inventory_ledgerTransaction;
  "model/inventory/requestIdentity": typeof model_inventory_requestIdentity;
  "model/inventory/reversal": typeof model_inventory_reversal;
  "model/inventory/stockIdentity": typeof model_inventory_stockIdentity;
  "model/masterData/catalogueRules": typeof model_masterData_catalogueRules;
  "model/orderToShip/customerOrder": typeof model_orderToShip_customerOrder;
  "model/orderToShip/designReadiness": typeof model_orderToShip_designReadiness;
  "model/orderToShip/designRequest": typeof model_orderToShip_designRequest;
  "model/orderToShip/designSpecification": typeof model_orderToShip_designSpecification;
  "model/orderToShip/factoryPacket": typeof model_orderToShip_factoryPacket;
  "model/orderToShip/masterCardFile": typeof model_orderToShip_masterCardFile;
  "model/orderToShip/masterCardImport": typeof model_orderToShip_masterCardImport;
  "model/orderToShip/masterCardRelease": typeof model_orderToShip_masterCardRelease;
  "model/orderToShip/masterCardRevision": typeof model_orderToShip_masterCardRevision;
  "model/orderToShip/orderImport": typeof model_orderToShip_orderImport;
  "model/platform/commandClassification": typeof model_platform_commandClassification;
  "model/platform/deviceRegistry": typeof model_platform_deviceRegistry;
  "model/platform/quantityEntry": typeof model_platform_quantityEntry;
  "model/platform/stepUp": typeof model_platform_stepUp;
  "model/platform/taskAssignment": typeof model_platform_taskAssignment;
  "model/production/productionExecution": typeof model_production_productionExecution;
  "model/reporting/csv": typeof model_reporting_csv;
  "model/reporting/exportCursor": typeof model_reporting_exportCursor;
  "model/reporting/occupancy": typeof model_reporting_occupancy;
  "model/reporting/operationalViews": typeof model_reporting_operationalViews;
  "model/reporting/rollup": typeof model_reporting_rollup;
  "model/result": typeof model_result;
  "model/rotation/stockRotation": typeof model_rotation_stockRotation;
  "model/storageLayout/storageLayout": typeof model_storageLayout_storageLayout;
  "model/storageLayout/storageZone": typeof model_storageLayout_storageZone;
  "model/time/businessDate": typeof model_time_businessDate;
  "model/transfer/transferPolicy": typeof model_transfer_transferPolicy;
  "model/uom/itemUom": typeof model_uom_itemUom;
  "model/uom/quantity": typeof model_uom_quantity;
  "model/uom/ratio": typeof model_uom_ratio;
  "platform/devices": typeof platform_devices;
  "platform/exceptions": typeof platform_exceptions;
  "platform/stepUp": typeof platform_stepUp;
  "platform/taskFiles": typeof platform_taskFiles;
  "platform/tasks": typeof platform_tasks;
  "production/orders": typeof production_orders;
  "production/packets": typeof production_packets;
  "purchasing/orders": typeof purchasing_orders;
  "putaway/tasks": typeof putaway_tasks;
  "quality/inspections": typeof quality_inspections;
  "receiving/receipts": typeof receiving_receipts;
  "reporting/dashboard": typeof reporting_dashboard;
  "reporting/exports": typeof reporting_exports;
  "reporting/operationalViews": typeof reporting_operationalViews;
  "reporting/rollups": typeof reporting_rollups;
  "sales/customers": typeof sales_customers;
  "sales/orders": typeof sales_orders;
  "storageLayouts/catalogue": typeof storageLayouts_catalogue;
  "storageLayouts/writes": typeof storageLayouts_writes;
  "storageLayouts/zones": typeof storageLayouts_zones;
  "transfers/requests": typeof transfers_requests;
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
