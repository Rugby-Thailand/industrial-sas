"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Camera, CheckCircle2, Keyboard, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/PageContainer";
import { Panel } from "@/components/ui/Panel";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { ScanIcon } from "@/components/ui/ScanIcon";
import { Link } from "@/i18n/navigation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { useUploadThing } from "@/lib/uploadthing";
import {
  ErrorNotice,
  Heading,
  Loading,
  useCanManage,
  useDraftKey,
  useOperation,
  useUnsavedWarning,
  ViewOnlyNotice,
  written,
} from "../shared";
import { BarcodeCameraBox } from "../BarcodeCameraBox";
import { LocationPicker } from "./LocationPicker";
import { PhotoCapture } from "./PhotoCapture";
import { TicketCard } from "./TicketCard";
import { TicketFieldScanner } from "./TicketFieldScanner";
import { resizeImage, toDataUrl } from "./resizeImage";
import {
  applyBarcode,
  applyImageBarcodes,
  classifyTicketBarcode,
  isComplete,
  hasInvalidQuantity,
  duplicateTicketKeys,
  mergeExtracted,
  newTicket,
  toPayload,
  pickedLocationPayload,
  type PickedLocation,
  type TicketDraft,
  type TicketCodeField,
  ticketBarcodeError,
} from "./ticketDraft";

type FieldScanTarget = {
  key: string;
  field: TicketCodeField;
  value: string;
  index: number;
};

export const JOB_SCAN_PATH = "/finished-goods/scan";
export const JOB_SCAN_RECORDS_PATH = "/finished-goods/scan/records";
const acquisitionButtonClass =
  "min-h-14 flex-col gap-1 px-1 text-xs sm:min-h-11 sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm";

export function JobScanScreen() {
  const scope = useDraftKey("fg-job-scan");
  if (!scope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <JobScanWorkflow
          key={`${scope}:${warehouseId}`}
          warehouseId={warehouseId}
        />
      )}
    </QueryGate>
  );
}

export function LocationSummary({
  code,
  name,
  mapped,
}: {
  code: string;
  name?: string | undefined;
  mapped: boolean;
}) {
  const t = useTranslations("JobScan");
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <MapPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="font-mono font-semibold break-all">{code}</span>
      <StatusBadge
        tone={mapped ? "success" : "warning"}
        label={mapped ? t("mapped") : t("unmapped")}
      />
      {name && (
        <span className="w-full truncate pl-6 text-sm text-muted">{name}</span>
      )}
    </span>
  );
}

function JobScanWorkflow({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations("JobScan");
  const canManage = useCanManage();
  const operation = useOperation();
  const extract = useAction(fgRefs.extractJobTicket);
  const save = useMutation(fgRefs.saveJobScans);
  const { startUpload } = useUploadThing("jobTicketImage");
  const [location, setLocation] = useState<PickedLocation>();
  const [tickets, setTickets] = useState<TicketDraft[]>([]);
  const [panel, setPanel] = useState<"PHOTO" | "BARCODE" | null>(null);
  const panelRef = useRef<typeof panel>(null);
  const [fieldScan, setFieldScan] = useState<FieldScanTarget | null>(null);
  const fieldScanRef = useRef<FieldScanTarget | null>(null);
  const [feedback, setFeedback] = useState<string>();
  const [saved, setSaved] = useState<{
    count: number;
    location: PickedLocation;
  }>();
  const saving = operation.busy;
  // Stop late camera/file callbacks synchronously, before React commits busy UI.
  const acquisitionBlocked = useRef(false);
  const [reviewedDuplicates, setReviewedDuplicates] = useState("");
  const duplicateKeys = duplicateTicketKeys(tickets);
  const duplicateFingerprint = JSON.stringify(
    tickets
      .filter((ticket) => duplicateKeys.includes(ticket.key))
      .map((ticket) => [ticket.key, ticket.values]),
  );
  const duplicatesReviewed = reviewedDuplicates === duplicateFingerprint;
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  useUnsavedWarning(tickets.length > 0);

  const releasePreview = (ticket: TicketDraft) => {
    if (!ticket.previewUrl) return;
    URL.revokeObjectURL(ticket.previewUrl);
    previewUrls.current.delete(ticket.previewUrl);
  };

  const update = (key: string, change: (ticket: TicketDraft) => TicketDraft) =>
    setTickets((current) =>
      current.map((ticket) => (ticket.key === key ? change(ticket) : ticket)),
    );

  function closeFieldScan() {
    fieldScanRef.current = null;
    setFieldScan(null);
  }
  function changePanel(next: typeof panel) {
    closeFieldScan();
    setFeedback(undefined);
    panelRef.current = next;
    setPanel(next);
  }
  function openFieldScan(
    ticket: TicketDraft,
    field: TicketCodeField,
    index: number,
  ) {
    if (acquisitionBlocked.current || !canManage || ticket.status !== "ready")
      return;
    changePanel(null);
    const target = {
      key: ticket.key,
      field,
      value: ticket.values[field] ?? "",
      index,
    };
    fieldScanRef.current = target;
    setFieldScan(target);
  }
  function applyFieldScan(target: FieldScanTarget, code: string) {
    if (
      acquisitionBlocked.current ||
      !canManage ||
      fieldScanRef.current !== target
    )
      return;
    closeFieldScan();
    update(target.key, (row) => {
      // A changed or removed target must never fall back to another ticket.
      if (
        row.status !== "ready" ||
        (row.values[target.field] ?? "") !== target.value
      )
        return row;
      return {
        ...row,
        values: { ...row.values, [target.field]: code },
        aiFields: row.aiFields.filter((field) => field !== target.field),
      };
    });
    setFeedback(t("barcodeAdded", { field: t(target.field), code }));
  }

  async function onPhoto(file: File) {
    if (acquisitionBlocked.current) return;
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    const ticket = {
      ...newTicket("AI"),
      status: "reading" as const,
      previewUrl,
    };
    setTickets((current) => [...current, ticket]);
    let image: File;
    try {
      image = await resizeImage(file);
    } catch {
      update(ticket.key, (row) => ({
        ...row,
        status: "ready",
        notice: "photoProcessingFailed",
      }));
      return;
    }
    // The AI reads the photo directly, so a failed upload only loses the stored copy.
    const [uploaded, outcome] = await Promise.all([
      startUpload([image]).catch((error: unknown) => {
        console.error("Job ticket upload failed", error);
        return undefined;
      }),
      toDataUrl(image)
        .then((imageUrl) => extract({ warehouseId, imageUrl }))
        .catch(() => undefined),
    ]);
    const imageUrl = uploaded?.[0]?.ufsUrl;
    const result = outcome?.ok ? outcome.value : undefined;
    update(ticket.key, (row) => ({
      ...(result?.ok ? mergeExtracted(row, result.fields) : row),
      status: "ready",
      ...(imageUrl ? { imageUrl } : {}),
      ...(result?.ok ? { aiRaw: result.raw } : {}),
      notice: !result?.ok
        ? "aiFailed"
        : !imageUrl
          ? "uploadFailed"
          : result.mock
            ? "aiMock"
            : "aiFilled",
    }));
  }

  function onBarcode(code: string) {
    if (acquisitionBlocked.current || panelRef.current !== "BARCODE") return;
    const value = code.trim();
    const field = classifyTicketBarcode(value);
    const problem = ticketBarcodeError(field, value);
    if (problem) {
      setFeedback(t(problem));
      return;
    }
    setTickets((current) => applyBarcode(current, value).tickets);
    setFeedback(t("barcodeAdded", { field: t(field), code: value }));
  }

  function onImageCodes(codes: string[]) {
    if (acquisitionBlocked.current || panelRef.current !== "BARCODE") return;
    const values = codes.map((code) => code.trim());
    for (const code of values) {
      const field = classifyTicketBarcode(code);
      const problem = ticketBarcodeError(field, code);
      if (problem) {
        setFeedback(t(problem));
        return;
      }
    }
    setTickets((current) => applyImageBarcodes(current, values));
    setFeedback(t("barcodeImageRead"));
  }

  async function submit() {
    if (
      !location ||
      acquisitionBlocked.current ||
      !tickets.length ||
      tickets.some(
        (ticket) =>
          ticket.status === "reading" ||
          !isComplete(ticket) ||
          hasInvalidQuantity(ticket),
      ) ||
      (duplicateKeys.length > 0 && !duplicatesReviewed)
    )
      return;
    const mappedLocation = pickedLocationPayload(location);
    const payload = {
      warehouseId,
      locationText: location.text,
      ...(mappedLocation ? { location: mappedLocation } : {}),
      items: tickets.map(toPayload),
    };
    acquisitionBlocked.current = true;
    changePanel(null);
    const result = await operation.run(async () =>
      written(
        await save({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      ),
    );
    if (result === null) {
      acquisitionBlocked.current = false;
      return;
    }
    operation.clearRequests();
    tickets.forEach(releasePreview);
    setSaved({ count: tickets.length, location });
    setTickets([]);
    changePanel(null);
  }

  if (!canManage) return <ViewOnlyNotice />;

  if (saved)
    return (
      <PageContainer size="form">
        <Panel className="space-y-3 text-center">
          <CheckCircle2
            className="mx-auto size-12 text-success"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold">
            {t("saved", { count: saved.count })}
          </h1>
          <p className="text-muted">
            {t("savedAt", {
              location: saved.location.code ?? saved.location.text,
            })}
          </p>
          {saved.location.buildingName && (
            <p className="text-sm text-muted">
              {saved.location.buildingName}
              {saved.location.floorNumber === undefined
                ? ""
                : ` · ${t("floorNumber", { number: saved.location.floorNumber })}`}
            </p>
          )}
          <p className="text-sm text-muted">{t("locationNotStock")}</p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button
              className="min-h-12"
              onClick={() => {
                acquisitionBlocked.current = false;
                setSaved(undefined);
              }}
            >
              {t("scanMore")}
            </Button>
            <Button asChild variant="outline" className="min-h-12">
              <Link href={JOB_SCAN_RECORDS_PATH}>{t("viewRecords")}</Link>
            </Button>
          </div>
        </Panel>
      </PageContainer>
    );

  if (!location)
    return (
      <PageContainer size="form">
        <Heading title={t("title")} description={t("subtitle")} />
        <Panel className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{t("locationStepTitle")}</h2>
            <p className="text-sm text-muted">{t("locationStepHint")}</p>
          </div>
          <LocationPicker
            warehouseId={warehouseId}
            onPick={setLocation}
            canReadImage={canManage}
          />
        </Panel>
      </PageContainer>
    );

  const reading = tickets.some((ticket) => ticket.status === "reading");
  const incomplete = tickets.some((ticket) => !isComplete(ticket));
  const invalidQuantity = tickets.some(hasInvalidQuantity);
  const blocker = reading
    ? t("waitReading")
    : incomplete
      ? t("saveBlocked")
      : invalidQuantity
        ? t("invalidQuantity")
        : duplicateKeys.length > 0 && !duplicatesReviewed
          ? t("duplicateTickets")
          : null;

  return (
    <PageContainer size="form" actionInset="responsive">
      <Heading title={t("title")} description={t("locationNotStock")} />
      <div className="-mt-4 flex min-h-11 flex-wrap items-center gap-2 text-sm">
        <MapPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="max-w-full font-mono font-semibold break-all">
          {location.code ?? location.text}
        </span>
        {location.name && (
          <span className="min-w-0 truncate text-muted">{location.name}</span>
        )}
        {location.buildingName && (
          <span className="w-full text-sm text-muted">
            {location.buildingName}
            {location.floorNumber === undefined
              ? ""
              : ` · ${t("floorNumber", { number: location.floorNumber })}`}
          </span>
        )}
        <StatusBadge
          tone={location.locationId || location.zoneId ? "success" : "warning"}
          label={
            location.locationId || location.zoneId ? t("mapped") : t("unmapped")
          }
        />
        <button
          type="button"
          className="ml-auto min-h-11 shrink-0 px-1 font-semibold text-link hover:underline disabled:text-disabled"
          disabled={saving}
          onClick={() => {
            changePanel(null);
            setLocation(undefined);
          }}
        >
          {t("change")}
        </button>
      </div>

      <fieldset
        disabled={saving}
        aria-busy={saving}
        className="min-w-0 space-y-3"
      >
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant={panel === "PHOTO" ? "default" : "outline"}
            className={acquisitionButtonClass}
            aria-pressed={panel === "PHOTO"}
            onClick={() => changePanel(panel === "PHOTO" ? null : "PHOTO")}
          >
            <Camera className="size-4" aria-hidden="true" />
            {t("photo")}
          </Button>
          <Button
            variant={panel === "BARCODE" ? "default" : "outline"}
            className={acquisitionButtonClass}
            aria-pressed={panel === "BARCODE"}
            onClick={() => {
              changePanel(panel === "BARCODE" ? null : "BARCODE");
            }}
          >
            <ScanIcon className="size-4" aria-hidden="true" />
            {t("barcode")}
          </Button>
          <Button
            variant="outline"
            className={acquisitionButtonClass}
            onClick={() =>
              setTickets((current) => [...current, newTicket("MANUAL")])
            }
          >
            <Keyboard className="size-4" aria-hidden="true" />
            {t("manual")}
          </Button>
        </div>
        {panel === "PHOTO" && (
          <PhotoCapture
            onClose={() => changePanel(null)}
            onSubmit={(files) => {
              changePanel(null);
              // Every photo becomes its own ticket; the AI reads them all at once.
              files.forEach((file) => void onPhoto(file));
            }}
          />
        )}
        {panel === "BARCODE" && !saving && (
          <BarcodeCameraBox
            mode="PACKAGES"
            imageTarget="TICKET"
            onImageCodes={onImageCodes}
            onCode={onBarcode}
            onClose={() => changePanel(null)}
            feedback={feedback}
          />
        )}
        {feedback && panel !== "BARCODE" && !fieldScan && (
          <p role="status" className="text-sm text-success">
            {feedback}
          </p>
        )}
        {tickets.length ? (
          <ol className="space-y-3">
            {tickets.map((ticket, index) => (
              <TicketCard
                key={ticket.key}
                ticket={ticket}
                duplicate={duplicateKeys.includes(ticket.key)}
                index={index}
                disabled={saving}
                onScan={(field) => openFieldScan(ticket, field, index)}
                onChange={(field, value) => {
                  if (panelRef.current === "BARCODE") changePanel(null);
                  update(ticket.key, (row) => ({
                    ...row,
                    values: { ...row.values, [field]: value },
                    aiFields: row.aiFields.filter((name) => name !== field),
                  }));
                }}
                onFormatChange={(storageFormat) =>
                  setTickets((previous) =>
                    previous.map((item) =>
                      item.key === ticket.key
                        ? { ...item, storageFormat }
                        : item,
                    ),
                  )
                }
                onRemove={() => {
                  if (panelRef.current === "BARCODE") changePanel(null);
                  if (fieldScanRef.current?.key === ticket.key)
                    closeFieldScan();
                  releasePreview(ticket);
                  setTickets((current) =>
                    current.filter((row) => row.key !== ticket.key),
                  );
                }}
              />
            ))}
          </ol>
        ) : (
          <Panel as="p" className="text-muted">
            {t("noTickets")}
          </Panel>
        )}
        {fieldScan &&
          !saving &&
          tickets.some(
            (ticket) =>
              ticket.key === fieldScan.key && ticket.status === "ready",
          ) && (
            <TicketFieldScanner
              key={`${fieldScan.key}:${fieldScan.field}`}
              field={fieldScan.field}
              index={fieldScan.index}
              value={fieldScan.value}
              onApply={(code) => applyFieldScan(fieldScan, code)}
              onClose={closeFieldScan}
            />
          )}
        {duplicateKeys.length > 0 && (
          <label className="flex min-h-11 items-start gap-3 rounded-md border border-warning p-3 text-sm">
            <CheckboxControl
              className="mt-1 shrink-0"
              checked={duplicatesReviewed}
              onChange={(event) =>
                setReviewedDuplicates(
                  event.target.checked ? duplicateFingerprint : "",
                )
              }
            />
            <span>{t("duplicateReview")}</span>
          </label>
        )}
      </fieldset>
      <ErrorNotice message={operation.error} />

      <StickyActionBar placement="responsive">
        <div className="mx-auto max-w-3xl">
          <Button
            className="min-h-12 w-full"
            disabled={!tickets.length || Boolean(blocker) || saving}
            onClick={() => void submit()}
          >
            {saving ? t("saving") : t("save", { count: tickets.length })}
          </Button>
          {tickets.length > 0 && blocker && (
            <p role="status" className="mt-2 text-sm text-muted">
              {blocker}
            </p>
          )}
        </div>
      </StickyActionBar>
    </PageContainer>
  );
}
