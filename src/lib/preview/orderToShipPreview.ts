import type {
  CustomerOrderRow,
  DesignRequestRow,
  FactoryPacketRow,
} from "../convex/orderToShipApi";

const SPECIFICATION = Object.freeze({
  styleCode: "RSC",
  internalLengthMm: 300,
  internalWidthMm: 200,
  internalHeightMm: 150,
  boardGrade: "KA125/C/KA125",
  printColourCount: 2,
  productNameEn: "Export carton",
  productNameTh: "กล่องส่งออก",
  sheetLengthMm: 1010,
  sheetWidthMm: 465,
  fluteCode: "C",
  layers: [{ position: 1, paperCode: "KA125", grammageGsm: 125 }],
  route: [
    { sequence: 10, workCenterCode: "PRN-01", operationCode: "PRINT" },
    { sequence: 20, workCenterCode: "SLT-01", operationCode: "SLOT" },
    { sequence: 30, workCenterCode: "GLU-01", operationCode: "GLUE" },
  ],
  materials: [
    {
      itemCode: "BOARD-KA125-C",
      description: "C-flute corrugated board",
      quantityPerUnit: 1,
      uom: "SHEET",
    },
  ],
  qualityRequirements: [
    {
      code: "BCT",
      description: "Box compression strength",
      target: ">= 4500 N",
    },
  ],
  calculations: [
    {
      name: "BCT",
      formulaVersion: "MCKEE-2026-01",
      inputs: [
        { name: "ECT", value: 7.1, unit: "kN/m" },
        { name: "perimeter", value: 1_000, unit: "mm" },
      ],
      result: 4680,
      unit: "N",
      passed: true,
      verifiedByUserId: "prv_engineer_nok",
      verifiedAt: Date.UTC(2026, 7, 14),
    },
  ],
});

export const previewCustomerOrders = (): readonly CustomerOrderRow[] => [
  {
    customerOrderId: "prv_so_26018",
    orderNumber: "SO-26018",
    customerId: "prv_customer_gold",
    customerReference: "PO-GOLD-8812",
    status: "RELEASED",
    orderedAt: Date.UTC(2026, 7, 14),
  },
  {
    customerOrderId: "prv_so_26019",
    orderNumber: "SO-26019",
    customerId: "prv_customer_siam",
    customerReference: "PO-SIAM-1044",
    status: "DRAFT",
    orderedAt: Date.UTC(2026, 7, 15),
  },
];

export const previewDesignRequests = (): readonly DesignRequestRow[] => [
  {
    designRequestId: "prv_dr_42",
    requestNumber: "SO-26019-1",
    customerOrderLineId: "prv_sol_26019_1",
    customerId: "prv_customer_siam",
    customerProductCode: "SIAM-FG-024",
    designKey: "RSC|300x200x150|KA125/C/KA125|C2",
    specification: SPECIFICATION,
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueAt: Date.UTC(2026, 7, 16),
    overdue: false,
    assignedToUserId: "prv_engineer_nok",
    latestRequirementVersion: 1,
    requirementReadiness: "INCOMPLETE",
    missingRequirements: ["PACKING"],
  },
  {
    designRequestId: "prv_dr_41",
    requestNumber: "SO-26018-2",
    customerOrderLineId: "prv_sol_26018_2",
    customerId: "prv_customer_gold",
    customerProductCode: "GOLD-BOX-991",
    designKey: "RSC|250x180x120|KT125/B/KT125|C1",
    specification: { ...SPECIFICATION, internalLengthMm: 250 },
    status: "IN_REVIEW",
    priority: "URGENT",
    latestRequirementVersion: 2,
    requirementReadiness: "READY",
    missingRequirements: [],
    dueAt: Date.UTC(2026, 7, 15),
    overdue: true,
    assignedToUserId: "prv_engineer_dee",
  },
];

export const previewFactoryPackets = (): readonly FactoryPacketRow[] => [
  {
    factoryPacketId: "prv_packet_26018_1",
    warehouseId: "prv_wh_bangpoo",
    packetNumber: "SO-26018-1",
    customerOrderLineId: "prv_sol_26018_1",
    customerId: "prv_customer_gold",
    customerOrderNumber: "SO-26018",
    customerReference: "PO-GOLD-8812",
    masterCardRevisionId: "prv_rev_4",
    revisionNumber: 4,
    specification: SPECIFICATION,
    approvedFileIds: ["prv_file_dieline", "prv_file_artwork"],
    releaseEvidence: {
      releasedByUserId: "prv_engineering_approver",
      releasedAt: Date.UTC(2026, 7, 14, 8, 30),
      decisionNote: "Dieline, artwork, route, and BCT evidence verified.",
    },
    quantity: 2400,
    status: "ISSUED",
    issuedByUserId: "prv_planner",
  },
];
