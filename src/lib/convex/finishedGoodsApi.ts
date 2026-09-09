import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "./clientRef";

export const fgRefs = Object.freeze({
  saveBatchDraft: clientRef(api.finishedGoods.batches.saveBatchDraft),
  commitBatch: clientRef(api.finishedGoods.batches.commitBatch),
  getBatch: clientRef(api.finishedGoods.batches.getBatch),
  listProductBatches: clientRef(api.finishedGoods.batches.listProductBatches),
  cancelLegacyUnit: clientRef(api.finishedGoods.batches.cancelLegacyUnit),
  stackOptions: clientRef(api.finishedGoods.workflow.stackOptions),
  saveStackingLimits: clientRef(api.finishedGoods.workflow.saveStackingLimits),
  list: clientRef(api.finishedGoods.workflow.list),
  getProduct: clientRef(api.finishedGoods.workflow.getProduct),
  getPallet: clientRef(api.finishedGoods.workflow.getPallet),
  recommend: clientRef(api.finishedGoods.workflow.recommend),
  recommendMove: clientRef(api.finishedGoods.workflow.recommendMove),
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
export type Candidate = RefValue<typeof fgRefs.recommend>["candidates"][number];
export type FinishedGoodsList = RefValue<typeof fgRefs.list>;

export type BatchDetail = NonNullable<RefValue<typeof fgRefs.getBatch>>;
export type PreparationBatch = BatchDetail["batch"];
