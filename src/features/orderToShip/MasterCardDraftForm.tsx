"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type {
  FormFieldSpec,
  FormSectionSpec,
  FormValues,
} from "@/components/masterData/EntityForm";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  createMasterCardRef,
  draftMasterCardRevisionRef,
  type BoxSpecification,
} from "@/lib/convex/orderToShipApi";

const whole = (value: string | undefined): number =>
  Number.parseInt(value ?? "", 10);
const decimal = (value: string | undefined): number =>
  Number.parseFloat(value ?? "");
const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
const rows = (value: string | undefined): string[][] =>
  (value ?? "")
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split("|").map((cell) => cell.trim()));

const baseSpecificationFields = (
  t: ReturnType<typeof useTranslations>,
  initial?: BoxSpecification,
): readonly FormFieldSpec[] => {
  const initialValue = (name: string): string | undefined => {
    if (initial === undefined) return undefined;
    const scalar = initial[name as keyof BoxSpecification];
    if (typeof scalar === "string" || typeof scalar === "number")
      return String(scalar);
    if (name === "printColours") return initial.printColours?.join(", ");
    if (name === "finishing") return initial.finishing?.join(", ");
    if (name === "layerRows")
      return initial.layers
        ?.map((row) => `${row.position}|${row.paperCode}|${row.grammageGsm}`)
        .join("\n");
    if (name === "routeRows")
      return initial.route
        ?.map(
          (row) =>
            `${row.sequence}|${row.workCenterCode}|${row.operationCode}|${row.instruction ?? ""}`,
        )
        .join("\n");
    if (name === "materialRows")
      return initial.materials
        ?.map(
          (row) =>
            `${row.itemCode}|${row.description}|${row.quantityPerUnit}|${row.uom}|${row.wastePercent ?? ""}`,
        )
        .join("\n");
    if (name === "qualityRows")
      return initial.qualityRequirements
        ?.map(
          (row) =>
            `${row.code}|${row.description}|${row.target}|${row.tolerance ?? ""}`,
        )
        .join("\n");
    if (name === "calculationRows")
      return initial.calculations
        ?.map((row) => {
          const input = row.inputs[0];
          return `${row.name}|${row.formulaVersion}|${input?.name ?? ""}|${input?.value ?? ""}|${input?.unit ?? ""}|${row.result}|${row.unit}|${row.passed ? "PASS" : "FAIL"}`;
        })
        .join("\n");
    return undefined;
  };
  const field = (
    name: string,
    label: string,
    kind: FormFieldSpec["kind"],
    required = false,
    hint?: string,
  ): FormFieldSpec => ({
    name,
    label: t(label),
    kind,
    required,
    ...(hint === undefined ? {} : { hint: t(hint) }),
    ...(initialValue(name) === undefined
      ? {}
      : { initialValue: initialValue(name)! }),
  });
  return [
    field("finishedGoodItemCode", "finishedGoodItemCode", "text"),
    field("boxType", "boxType", "text"),
    field("productNameEn", "productNameEn", "text", true),
    field("productNameTh", "productNameTh", "text", true),
    field("styleCode", "styleCode", "text", true),
    field("boardGrade", "boardGrade", "text", true),
    field("fluteCode", "flute", "text", true),
    field("internalLengthMm", "internalLengthMm", "number", true),
    field("internalWidthMm", "internalWidthMm", "number", true),
    field("internalHeightMm", "internalHeightMm", "number", true),
    field("sheetLengthMm", "sheetLengthMm", "number", true),
    field("sheetWidthMm", "sheetWidthMm", "number", true),
    field("piecesPerSheet", "piecesPerSheet", "number"),
    field("piecesPerSet", "piecesPerSet", "number"),
    field("lengthToleranceMm", "lengthToleranceMm", "number"),
    field("widthToleranceMm", "widthToleranceMm", "number"),
    field("heightToleranceMm", "heightToleranceMm", "number"),
    field("printColourCount", "printColourCount", "number", true),
    field("printMethod", "printMethod", "text"),
    field(
      "printColours",
      "printColours",
      "textarea",
      false,
      "commaSeparatedHint",
    ),
    field("printSide", "printSide", "text"),
    field("coatingSide", "coatingSide", "text"),
    field("creaseSide", "creaseSide", "text"),
    field("dieBlockCode", "dieBlockCode", "text"),
    field("dieBlockStorageLocation", "dieBlockStorageLocation", "text"),
    field("printingPlateCode", "printingPlateCode", "text"),
    field(
      "printingPlateStorageLocation",
      "printingPlateStorageLocation",
      "text",
    ),
    field("finishing", "finishing", "textarea", false, "commaSeparatedHint"),
    field("jointType", "jointType", "text"),
    field("glueType", "glueType", "text"),
    field("wirePerCarton", "wirePerCarton", "number"),
    field("unitsPerCarton", "unitsPerCarton", "number"),
    field("bundleQuantity", "bundleQuantity", "number"),
    field("palletQuantity", "palletQuantity", "number"),
    field("packingInstructions", "packingInstructions", "textarea"),
    field("layerRows", "paperLayers", "textarea", true, "layerRowsHint"),
    field("routeRows", "routeSteps", "textarea", true, "routeRowsHint"),
    field("materialRows", "materials", "textarea", true, "materialRowsHint"),
    field(
      "qualityRows",
      "qualityRequirements",
      "textarea",
      true,
      "qualityRowsHint",
    ),
    field(
      "calculationRows",
      "calculations",
      "textarea",
      true,
      "calculationRowsHint",
    ),
    field("notes", "notes", "textarea"),
  ];
};

const optionalWhole = (value: string | undefined): number | undefined =>
  (value ?? "").length === 0 ? undefined : whole(value);

const specificationOf = (values: FormValues): BoxSpecification => {
  const lengthToleranceMm = optionalWhole(values.lengthToleranceMm);
  const widthToleranceMm = optionalWhole(values.widthToleranceMm);
  const heightToleranceMm = optionalWhole(values.heightToleranceMm);
  const piecesPerSheet = optionalWhole(values.piecesPerSheet);
  const piecesPerSet = optionalWhole(values.piecesPerSet);
  const wirePerCarton = optionalWhole(values.wirePerCarton);
  const unitsPerCarton = optionalWhole(values.unitsPerCarton);
  const bundleQuantity = optionalWhole(values.bundleQuantity);
  const palletQuantity = optionalWhole(values.palletQuantity);
  return {
    styleCode: values.styleCode ?? "",
    internalLengthMm: whole(values.internalLengthMm),
    internalWidthMm: whole(values.internalWidthMm),
    internalHeightMm: whole(values.internalHeightMm),
    boardGrade: values.boardGrade ?? "",
    printColourCount: whole(values.printColourCount),
    ...(values.finishedGoodItemCode
      ? { finishedGoodItemCode: values.finishedGoodItemCode }
      : {}),
    ...(values.boxType ? { boxType: values.boxType } : {}),
    productNameEn: values.productNameEn ?? "",
    productNameTh: values.productNameTh ?? "",
    sheetLengthMm: whole(values.sheetLengthMm),
    sheetWidthMm: whole(values.sheetWidthMm),
    ...(piecesPerSheet === undefined ? {} : { piecesPerSheet }),
    ...(piecesPerSet === undefined ? {} : { piecesPerSet }),
    ...(lengthToleranceMm === undefined ? {} : { lengthToleranceMm }),
    ...(widthToleranceMm === undefined ? {} : { widthToleranceMm }),
    ...(heightToleranceMm === undefined ? {} : { heightToleranceMm }),
    fluteCode: values.fluteCode ?? "",
    ...(values.printMethod ? { printMethod: values.printMethod } : {}),
    ...(splitList(values.printColours).length === 0
      ? {}
      : { printColours: splitList(values.printColours) }),
    ...(values.printSide ? { printSide: values.printSide } : {}),
    ...(values.coatingSide ? { coatingSide: values.coatingSide } : {}),
    ...(values.creaseSide ? { creaseSide: values.creaseSide } : {}),
    ...(values.dieBlockCode ? { dieBlockCode: values.dieBlockCode } : {}),
    ...(values.dieBlockStorageLocation
      ? { dieBlockStorageLocation: values.dieBlockStorageLocation }
      : {}),
    ...(values.printingPlateCode
      ? { printingPlateCode: values.printingPlateCode }
      : {}),
    ...(values.printingPlateStorageLocation
      ? { printingPlateStorageLocation: values.printingPlateStorageLocation }
      : {}),
    ...(splitList(values.finishing).length === 0
      ? {}
      : { finishing: splitList(values.finishing) }),
    ...(values.jointType ? { jointType: values.jointType } : {}),
    ...(values.glueType ? { glueType: values.glueType } : {}),
    ...(wirePerCarton === undefined ? {} : { wirePerCarton }),
    ...(unitsPerCarton === undefined ? {} : { unitsPerCarton }),
    ...(bundleQuantity === undefined ? {} : { bundleQuantity }),
    ...(palletQuantity === undefined ? {} : { palletQuantity }),
    ...(values.packingInstructions
      ? { packingInstructions: values.packingInstructions }
      : {}),
    layers: rows(values.layerRows).map(([position, paperCode, gsm]) => ({
      position: whole(position),
      paperCode: paperCode ?? "",
      grammageGsm: whole(gsm),
    })),
    route: rows(values.routeRows).map(
      ([sequence, workCenterCode, operationCode, instruction]) => ({
        sequence: whole(sequence),
        workCenterCode: workCenterCode ?? "",
        operationCode: operationCode ?? "",
        ...(instruction === undefined || instruction === ""
          ? {}
          : { instruction }),
      }),
    ),
    materials: rows(values.materialRows).map(
      ([itemCode, description, quantity, uom, waste]) => ({
        itemCode: itemCode ?? "",
        description: description ?? "",
        quantityPerUnit: decimal(quantity),
        uom: uom ?? "",
        ...(waste === undefined || waste === ""
          ? {}
          : { wastePercent: decimal(waste) }),
      }),
    ),
    qualityRequirements: rows(values.qualityRows).map(
      ([code, description, target, tolerance]) => ({
        code: code ?? "",
        description: description ?? "",
        target: target ?? "",
        ...(tolerance === undefined || tolerance === "" ? {} : { tolerance }),
      }),
    ),
    calculations: rows(values.calculationRows).map(
      ([
        name,
        formulaVersion,
        inputName,
        inputValue,
        inputUnit,
        result,
        unit,
        passed,
      ]) => ({
        name: name ?? "",
        formulaVersion: formulaVersion ?? "",
        inputs: [
          {
            name: inputName ?? "",
            value: decimal(inputValue),
            unit: inputUnit ?? "",
          },
        ],
        result: decimal(result),
        unit: unit ?? "",
        passed: passed === "PASS",
        verifiedByUserId: "SERVER",
        verifiedAt: 1,
      }),
    ),
    ...(values.notes ? { notes: values.notes } : {}),
  };
};

const masterCardSections = (
  t: ReturnType<typeof useTranslations>,
  identityPrefix: readonly string[],
  assets?: ReactNode,
): readonly FormSectionSpec[] => [
  {
    id: "identity",
    title: t("masterCardSectionIdentity"),
    description: t("masterCardSectionIdentityDetail"),
    fields: [
      ...identityPrefix,
      "finishedGoodItemCode",
      "productNameEn",
      "productNameTh",
      "boxType",
    ],
  },
  {
    id: "structure",
    title: t("masterCardSectionStructure"),
    description: t("masterCardSectionStructureDetail"),
    fields: [
      "styleCode",
      "boardGrade",
      "fluteCode",
      "internalLengthMm",
      "internalWidthMm",
      "internalHeightMm",
      "sheetLengthMm",
      "sheetWidthMm",
      "piecesPerSheet",
      "piecesPerSet",
      "lengthToleranceMm",
      "widthToleranceMm",
      "heightToleranceMm",
    ],
  },
  {
    id: "production",
    title: t("masterCardSectionProduction"),
    description: t("masterCardSectionProductionDetail"),
    fields: [
      "printColourCount",
      "printMethod",
      "printColours",
      "printSide",
      "coatingSide",
      "creaseSide",
      "dieBlockCode",
      "dieBlockStorageLocation",
      "printingPlateCode",
      "printingPlateStorageLocation",
      "finishing",
    ],
  },
  {
    id: "packing",
    title: t("masterCardSectionPacking"),
    description: t("masterCardSectionPackingDetail"),
    fields: [
      "jointType",
      "glueType",
      "wirePerCarton",
      "unitsPerCarton",
      "bundleQuantity",
      "palletQuantity",
      "packingInstructions",
    ],
  },
  {
    id: "process",
    title: t("masterCardSectionProcess"),
    description: t("masterCardSectionProcessDetail"),
    fields: [
      "layerRows",
      "routeRows",
      "materialRows",
      "qualityRows",
      "calculationRows",
      "notes",
    ],
  },
  ...(assets === undefined
    ? []
    : [
        {
          id: "assets",
          title: t("masterCardAssets"),
          description: t("masterCardAssetsDetail"),
          fields: [],
          content: assets,
        },
      ]),
];

export function MasterCardDraftForm({
  onSaved,
  assets,
}: {
  readonly onSaved?: (outcome: Record<string, unknown>) => void;
  readonly assets?: ReactNode;
} = {}) {
  const t = useTranslations("OrderToShip");
  const fields: readonly FormFieldSpec[] = [
    {
      name: "cardNumber",
      label: t("cardNumber"),
      kind: "text",
      required: true,
    },
    {
      name: "customerId",
      label: t("customerId"),
      kind: "text",
      required: true,
      monospace: true,
    },
    {
      name: "customerProductCode",
      label: t("customerProductCode"),
      kind: "text",
      required: true,
    },
    { name: "name", label: t("masterCardName"), kind: "text", required: true },
    ...baseSpecificationFields(t),
  ];
  const sections = masterCardSections(
    t,
    ["cardNumber", "customerId", "customerProductCode", "name"],
    assets,
  );
  return (
    <EntityWriteForm
      mutationRef={createMasterCardRef}
      legend={t("masterCardEditor")}
      description={t("masterCardEditorDetail")}
      submitLabel={t("saveMasterCard")}
      requiredMessage={t("requiredField")}
      dialogSize="workspace"
      testId="master-card-editor"
      {...(onSaved === undefined ? {} : { onSaved })}
      fields={fields}
      sections={sections}
      mobileStepperLabels={{
        step: (current, total) => t("stepProgress", { current, total }),
        previous: t("previousStep"),
        next: t("nextStep"),
      }}
      toArgs={(values, requestId) => ({
        requestId,
        cardNumber: values.cardNumber ?? "",
        customerId: values.customerId ?? "",
        customerProductCode: values.customerProductCode ?? "",
        name: values.name ?? "",
        specification: specificationOf(values),
      })}
    />
  );
}

export function MasterCardRevisionDraftForm({
  masterCardId,
  specification,
}: {
  readonly masterCardId: string;
  readonly specification: BoxSpecification;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <EntityWriteForm
      mutationRef={draftMasterCardRevisionRef}
      legend={t("draftChangedRevision")}
      description={t("draftChangedRevisionDetail")}
      submitLabel={t("saveChangedRevision")}
      requiredMessage={t("requiredField")}
      dialogSize="workspace"
      fields={[
        {
          name: "masterCardId",
          label: t("masterCardId"),
          kind: "text",
          required: true,
          monospace: true,
          initialValue: masterCardId,
        },
        ...baseSpecificationFields(t, specification),
      ]}
      sections={masterCardSections(t, ["masterCardId"])}
      mobileStepperLabels={{
        step: (current, total) => t("stepProgress", { current, total }),
        previous: t("previousStep"),
        next: t("nextStep"),
      }}
      toArgs={(values, requestId) => ({
        requestId,
        masterCardId: values.masterCardId ?? "",
        specification: specificationOf(values),
      })}
    />
  );
}
