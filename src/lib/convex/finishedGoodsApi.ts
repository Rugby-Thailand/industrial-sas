import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "./clientRef";

export const fgRefs = Object.freeze({
  prepareSummaries: clientRef(api.finishedGoods.summaryMaintenance.prepare),
  resolvePackageCode: clientRef(api.finishedGoods.scanning.resolvePackageCode),
  confirmScanAssignment: clientRef(
    api.finishedGoods.scanning.confirmScanAssignment,
  ),
  resolveLocationCode: clientRef(
    api.finishedGoods.scanning.resolveLocationCode,
  ),
  resolveJobScanLocation: clientRef(api.finishedGoods.jobScanLocations.resolve),
  createJobScanLocation: clientRef(api.finishedGoods.jobScanLocations.create),
  jobScanLocationOptions: clientRef(api.finishedGoods.jobScanLocations.options),
  jobScanBuildingOptions: clientRef(
    api.finishedGoods.jobScanLocations.buildingOptions,
  ),
  searchJobScanLocations: clientRef(
    api.finishedGoods.jobScanLocations.searchPage,
  ),
  extractJobTicket: clientRef(api.finishedGoods.jobScans.extractJobTicket),
  extractLocationLabel: clientRef(
    api.finishedGoods.locationImage.extractLocationLabel,
  ),
  updateJobScan: clientRef(api.finishedGoods.jobScans.updateJobScan),
  listJobScanCorrections: clientRef(
    api.finishedGoods.jobScans.listJobScanCorrections,
  ),
  saveJobScans: clientRef(api.finishedGoods.jobScans.saveJobScans),
  deleteJobScans: clientRef(api.finishedGoods.jobScans.deleteJobScans),
  assignJobScanLocation: clientRef(
    api.finishedGoods.jobScans.assignJobScanLocation,
  ),
  listJobScans: clientRef(api.finishedGoods.jobScans.listJobScans),
  getScanAssignment: clientRef(api.finishedGoods.scanning.getScanAssignment),
  cataloguePage: clientRef(api.finishedGoods.catalogue.page),
  catalogueSummary: clientRef(api.finishedGoods.catalogue.summary),
  productSummary: clientRef(api.finishedGoods.catalogue.productSummary),
  productBySku: clientRef(api.finishedGoods.catalogue.findSku),
  pageProductBatches: clientRef(api.finishedGoods.batches.pageProductBatches),
  pageLegacyUnits: clientRef(api.finishedGoods.batches.pageLegacyUnits),
  resolveUnitBatch: clientRef(api.finishedGoods.batches.resolveUnitBatch),
  saveBatchDraft: clientRef(api.finishedGoods.batches.saveBatchDraft),
  commitBatch: clientRef(api.finishedGoods.batches.commitBatch),
  getBatch: clientRef(api.finishedGoods.batches.getBatch),
  pageBatchRevisions: clientRef(api.finishedGoods.batches.pageBatchRevisions),
  cancelLegacyUnit: clientRef(api.finishedGoods.batches.cancelLegacyUnit),
  stackPreview: clientRef(api.finishedGoods.workflow.stackPreview),
  stackChoices: clientRef(api.finishedGoods.workflow.stackChoices),
  saveStackingLimits: clientRef(api.finishedGoods.workflow.saveStackingLimits),
  getProduct: clientRef(api.finishedGoods.workflow.getProduct),
  getPallet: clientRef(api.finishedGoods.workflow.getPallet),
  palletMoveHistory: clientRef(api.finishedGoods.history.palletMoveHistory),
  recommend: clientRef(api.finishedGoods.workflow.recommend),
  recommendMove: clientRef(api.finishedGoods.workflow.recommendMove),
  recommendationZone: clientRef(api.finishedGoods.workflow.recommendationZone),
  reserveMove: clientRef(api.finishedGoods.workflow.reserveMove),
  startMove: clientRef(api.finishedGoods.workflow.startMove),
  verifyMoveDestination: clientRef(
    api.finishedGoods.workflow.verifyMoveDestination,
  ),
  completeMove: clientRef(api.finishedGoods.workflow.completeMove),
  cancelMove: clientRef(api.finishedGoods.workflow.cancelMove),
  returnMove: clientRef(api.finishedGoods.workflow.returnMove),
  reportMoveIssue: clientRef(api.finishedGoods.workflow.reportMoveIssue),

  saveProduct: clientRef(api.finishedGoods.workflow.saveProduct),
  createPallet: clientRef(api.finishedGoods.workflow.createPallet),
  createPacking: clientRef(api.finishedGoods.workflow.createPacking),
  saveMeasurement: clientRef(api.finishedGoods.workflow.saveMeasurement),
  reserve: clientRef(api.finishedGoods.workflow.reserve),
  cancelReservation: clientRef(api.finishedGoods.workflow.cancelReservation),
  verifyDestination: clientRef(api.finishedGoods.workflow.verifyDestination),
  confirmStored: clientRef(api.finishedGoods.workflow.confirmStored),
});
export type Product = NonNullable<RefValue<typeof fgRefs.getProduct>>;
export type PalletDetail = NonNullable<RefValue<typeof fgRefs.getPallet>>;
export type Pallet = PalletDetail["pallet"];
export type Placement = NonNullable<PalletDetail["placement"]>;
export type Destination = NonNullable<PalletDetail["destination"]>;
/**
 * `recommend`/`recommendMove` results. Clients pass `view: "list"`, which omits
 * the per-zone preview fields from every candidate; the full result (no
 * `view`) is a subtype, so both read as this type.
 */
export type RecommendationList = RefValue<typeof fgRefs.recommend>;
export type ListedCandidate = RecommendationList["candidates"][number];
/** The preview fields every candidate of one zone shares (`recommendationZone`). */
export type ZonePreview = NonNullable<
  RefValue<typeof fgRefs.recommendationZone>
>;
/** A full candidate: `{ ...listed, ...zonePreview }`, as the editor previews it. */
export type Candidate = Destination;
type CataloguePage = RefValue<typeof fgRefs.cataloguePage>;
/** A hydrated product row of `finishedGoods/catalogue:page`, products tab. */
export type CatalogueProduct = CataloguePage["products"][number];
/** A hydrated unit row of `finishedGoods/catalogue:page`, units tab. */
export type CatalogueUnit = CataloguePage["pallets"][number];
/**
 * What the catalogue table and mobile list render. Products are the stored
 * product rows; the catalogue's per-product summaries arrive separately
 * (`productSummaries`), so a row need not carry `summary`.
 */
export interface FinishedGoodsRows {
  readonly products: readonly Omit<CatalogueProduct, "summary">[];
  readonly pallets: readonly CatalogueUnit[];
}

export type BatchDetail = NonNullable<RefValue<typeof fgRefs.getBatch>>;
export type PreparationBatch = BatchDetail["batch"];
