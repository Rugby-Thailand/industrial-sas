"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Camera,
  CheckCircle2,
  CircleAlert,
  Keyboard,
  MapPin,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { completeTask } from "@/lib/taskNavigation";
import { FG_PATH } from "@/lib/navigation";
import { useBackDisclosure } from "@/hooks/useBackDisclosure";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/PageContainer";
import { Panel } from "@/components/ui/Panel";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { ScanIcon } from "@/components/ui/ScanIcon";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { useUploadThing } from "@/lib/uploadthing";
import {
  ErrorNotice,
  Heading,
  Loading,
  useCanManage,
  useDraftKey,
  useOperation,
  ViewOnlyNotice,
  written,
} from "../shared";
import { BarcodeCameraBox } from "../BarcodeCameraBox";
import { AcquisitionModes } from "./AcquisitionModes";
import { LocationPicker } from "./LocationPicker";
import { usePhotoSelection } from "./usePhotoSelection";
import { PhotoCapture } from "./PhotoCapture";
import { ScanProgress } from "./ScanProgress";
import { TicketCard } from "./TicketCard";
import { TicketFieldScanner } from "./TicketFieldScanner";
import { toDataUrl } from "./imageDataUrl";
import {
  MAX_JOB_TICKET_AI_DATA_URL,
  MAX_JOB_TICKET_UPLOAD_BYTES,
  prepareJobTicketPhoto,
} from "./prepareJobTicketPhoto";
import {
  MAX_JOB_SCAN_ITEMS,
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
  type TicketWrite,
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
      {name && name !== code && (
        <span className="w-full truncate pl-6 text-sm text-muted">{name}</span>
      )}
    </span>
  );
}

function JobScanWorkflow({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations("JobScan");
  const router = useRouter();
  const canManage = useCanManage();
  const operation = useOperation();
  const extract = useAction(fgRefs.extractJobTicket);
  const save = useMutation(fgRefs.saveJobScans);
  const { startUpload } = useUploadThing("jobTicketImage");
  const [location, setLocation] = useState<PickedLocation>();
  const [tickets, setTicketState] = useState<TicketDraft[]>([]);
  const ticketsRef = useRef<TicketDraft[]>([]);
  function setTickets(
    change: TicketDraft[] | ((current: TicketDraft[]) => TicketDraft[]),
  ) {
    ticketsRef.current =
      typeof change === "function" ? change(ticketsRef.current) : change;
    setTicketState(ticketsRef.current);
  }
  const photos = usePhotoSelection(MAX_JOB_SCAN_ITEMS - tickets.length);
  const [panel, setPanel] = useState<"PHOTO" | "BARCODE" | null>(null);
  const panelRef = useRef<typeof panel>(null);
  const lastPanel = useRef<"PHOTO" | "BARCODE">("PHOTO");
  const [fieldScan, setFieldScan] = useState<FieldScanTarget | null>(null);
  const fieldScanRef = useRef<FieldScanTarget | null>(null);
  const [feedback, setFeedback] = useState<string>();
  // The ticket the last barcode-panel intake wrote, shown above the camera.
  const [lastWrite, setLastWrite] = useState<TicketWrite>();
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
  const photoOperations = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const urls = previewUrls.current;
    const operations = photoOperations.current;
    return () => {
      for (const controller of operations.values()) controller.abort();
      operations.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const releasePreview = (ticket: TicketDraft) => {
    photoOperations.current.get(ticket.key)?.abort();
    photoOperations.current.delete(ticket.key);
    if (!ticket.previewUrl) return;
    URL.revokeObjectURL(ticket.previewUrl);
    previewUrls.current.delete(ticket.previewUrl);
  };
  // Captured tickets survive in-app links, Back and search unless discarded;
  // a save in flight must finish first.
  function closeFieldScan() {
    fieldScanRef.current = null;
    setFieldScan(null);
  }
  function changePanel(next: typeof panel) {
    closeFieldScan();
    setFeedback(undefined);
    setLastWrite(undefined);
    panelRef.current = next;
    if (next) lastPanel.current = next;
    setPanel(next);
  }
  useBackDisclosure(panel !== null, (open) =>
    changePanel(open ? lastPanel.current : null),
  );
  const locationStep = useWorkflowStep(
    "jobScanStep",
    `job-scan:${warehouseId}`,
    Boolean(location),
    () => {
      changePanel(null);
      acquisitionBlocked.current = false;
    },
    { blocked: saving },
  );
  const draft = useNavigationDraft({
    workflowScope: `job-scan:${warehouseId}`,
    dirty: tickets.length > 0 || photos.photos.length > 0,
    pending: saving,
    discard: () => {
      tickets.forEach(releasePreview);
      setTickets([]);
      photos.clear();
      changePanel(null);
    },
  });

  const update = (key: string, change: (ticket: TicketDraft) => TicketDraft) =>
    setTickets((current) =>
      current.map((ticket) => (ticket.key === key ? change(ticket) : ticket)),
    );

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
    if (
      acquisitionBlocked.current ||
      ticketsRef.current.length >= MAX_JOB_SCAN_ITEMS
    )
      return;
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    const ticket = {
      ...newTicket("AI"),
      status: "reading" as const,
      previewUrl,
    };
    setTickets((current) => [...current, ticket]);
    const controller = new AbortController();
    photoOperations.current.set(ticket.key, controller);
    const current = () => !controller.signal.aborted;
    let reading: Promise<Awaited<ReturnType<typeof extract>> | undefined> =
      Promise.resolve(undefined);
    try {
      const image = await prepareJobTicketPhoto(file, {
        signal: controller.signal,
        onAiReady: async (aiFile) => {
          // Dispatch AI before WebP encoding; never await the AI response here.
          try {
            const imageUrl = await toDataUrl(aiFile);
            if (current() && imageUrl.length <= MAX_JOB_TICKET_AI_DATA_URL)
              reading = extract({ warehouseId, imageUrl }).catch(
                () => undefined,
              );
          } catch {
            // A failed AI input must not prevent storing the photo.
          }
        },
      });
      if (!current()) return;
      // AI and storage remain independent, including their different size limits.
      const [uploaded, outcome] = await Promise.all([
        image.size <= MAX_JOB_TICKET_UPLOAD_BYTES
          ? startUpload([image]).catch((error: unknown) => {
              console.error("Job ticket upload failed", error);
              return undefined;
            })
          : undefined,
        reading,
      ]);
      if (!current()) return;
      const imageUrl = uploaded?.[0]?.ufsUrl;
      const result = outcome?.ok ? outcome.value : undefined;
      update(ticket.key, (row) => ({
        ...(result?.ok ? mergeExtracted(row, result.fields) : row),
        status: "ready",
        ...(imageUrl ? { imageUrl } : {}),
        ...(result?.ok
          ? { aiRaw: result.raw, aiUsageOperationId: result.aiUsageOperationId }
          : {}),
        notice: !result?.ok
          ? "aiFailed"
          : !imageUrl
            ? "uploadFailed"
            : result.mock
              ? "aiMock"
              : "aiFilled",
      }));
    } catch {
      if (current())
        update(ticket.key, (row) => ({
          ...row,
          status: "ready",
          notice: "photoProcessingFailed",
        }));
    } finally {
      photoOperations.current.delete(ticket.key);
    }
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
    const current = ticketsRef.current;
    const next = applyBarcode(current, value);
    if (!next.written) {
      setFeedback(t("groupLimit", { max: MAX_JOB_SCAN_ITEMS }));
      return;
    }
    setTickets(next.tickets);
    setLastWrite(next.written);
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
    // Compute the whole acquisition before enforcing capacity. Applying a cap
    // per code would silently retain only part of an oversized image group.
    const next = applyImageBarcodes(ticketsRef.current, values, Infinity);
    if (next.tickets.length > MAX_JOB_SCAN_ITEMS) {
      setFeedback(t("groupLimit", { max: MAX_JOB_SCAN_ITEMS }));
      return;
    }
    setTickets(next.tickets);
    setLastWrite(next.written);
    setFeedback(t("barcodeImageRead"));
  }

  async function submit() {
    // Acquisition can update the live group before React commits its render.
    const currentTickets = ticketsRef.current;
    const currentDuplicates = duplicateTicketKeys(currentTickets);
    const currentFingerprint = JSON.stringify(
      currentTickets
        .filter((ticket) => currentDuplicates.includes(ticket.key))
        .map((ticket) => [ticket.key, ticket.values]),
    );
    if (
      photos.getFiles().length > 0 ||
      !location ||
      acquisitionBlocked.current ||
      !currentTickets.length ||
      currentTickets.length > MAX_JOB_SCAN_ITEMS ||
      currentTickets.some(
        (ticket) =>
          ticket.status === "reading" ||
          !isComplete(ticket) ||
          hasInvalidQuantity(ticket),
      ) ||
      (currentDuplicates.length > 0 &&
        reviewedDuplicates !== currentFingerprint)
    )
      return;
    const mappedLocation = pickedLocationPayload(location);
    const payload = {
      warehouseId,
      locationText: location.text,
      ...(mappedLocation ? { location: mappedLocation } : {}),
      items: currentTickets.map(toPayload),
    };
    acquisitionBlocked.current = true;
    closeFieldScan();
    const result = await operation.run(
      async () =>
        written(
          await save({
            ...payload,
            requestId: operation.request(JSON.stringify(payload)),
          }),
        ),
      () => {
        // Current completion only: a stale or unmounted save changes nothing.
        operation.clearRequests();
        currentTickets.forEach(releasePreview);
        draft.settle();
        setTickets([]);
        setSaved({ count: currentTickets.length, location });
        changePanel(null);
        operation.complete(() => completeTask(JOB_SCAN_PATH, router.replace));
      },
    );
    if (result === null) acquisitionBlocked.current = false;
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
              className="min-h-12 max-w-full break-words whitespace-normal"
              onClick={() => {
                acquisitionBlocked.current = false;
                setSaved(undefined);
                locationStep.enter();
              }}
            >
              {t("scanMore", {
                location: saved.location.code ?? saved.location.text,
              })}
            </Button>
            <Button asChild variant="outline" className="min-h-12">
              <Link href={JOB_SCAN_RECORDS_PATH}>{t("viewRecords")}</Link>
            </Button>
          </div>
        </Panel>
      </PageContainer>
    );

  if (!location || !locationStep.active)
    return (
      <PageContainer size="form">
        <Heading
          backFallbackHref={FG_PATH}
          title={t("locationStepTitle")}
          description={t("locationStepHint")}
        />
        <LocationPicker
          warehouseId={warehouseId}
          onPick={(value) => {
            setLocation(value);
            locationStep.enter();
          }}
          canReadImage={canManage}
          presentation="jobScan"
        />
      </PageContainer>
    );

  const reading = tickets.some((ticket) => ticket.status === "reading");
  const incomplete = tickets.some((ticket) => !isComplete(ticket));
  const invalidQuantity = tickets.some(hasInvalidQuantity);
  const blocker = photos.photos.length
    ? t("sendPhotosFirst")
    : reading
      ? t("waitReading")
      : incomplete
        ? t("saveBlocked")
        : invalidQuantity
          ? t("invalidQuantity")
          : duplicateKeys.length > 0 && !duplicatesReviewed
            ? t("duplicateTickets")
            : null;

  const mapped = Boolean(location.locationId || location.zoneId);
  const locationCode = location.code ?? location.text;
  const place = [
    location.buildingName,
    location.floorNumber === undefined
      ? undefined
      : t("floorNumber", { number: location.floorNumber }),
    // The code is already the heading; only a distinct name adds information.
    location.name === locationCode ? undefined : location.name,
  ].filter(Boolean);

  return (
    <PageContainer
      size="form"
      {...(tickets.length ? { actionInset: "responsive" as const } : {})}
    >
      <Heading
        backFallbackHref={FG_PATH}
        title={t("palletStepTitle")}
        description={t("palletStepHint")}
      />
      <Panel
        padding="compact"
        aria-label={t("location")}
        className="-mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:flex sm:gap-3"
      >
        {mapped ? (
          <CheckCircle2
            className="size-6 shrink-0 text-success"
            aria-hidden="true"
          />
        ) : (
          <CircleAlert
            className="size-6 shrink-0 text-warning"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono font-semibold break-all">{locationCode}</p>
          {place.length > 0 && (
            <p className="truncate text-sm text-muted">{place.join(" · ")}</p>
          )}
        </div>
        <div className="col-start-2 flex flex-wrap items-center gap-2 sm:contents">
          <StatusBadge
            tone={mapped ? "success" : "warning"}
            label={mapped ? t("mapped") : t("unmapped")}
          />
          <Button
            variant="ghost"
            className="ml-auto shrink-0 px-2 text-link sm:ml-0"
            disabled={saving}
            onClick={locationStep.back}
          >
            {t("change")}
          </Button>
        </div>
      </Panel>

      <fieldset
        disabled={saving}
        aria-busy={saving}
        className="min-w-0 space-y-3"
      >
        <p role="status" className="text-sm text-muted">
          {t("groupCapacity", {
            count: tickets.length,
            max: MAX_JOB_SCAN_ITEMS,
            remaining: MAX_JOB_SCAN_ITEMS - tickets.length,
          })}
        </p>
        <AcquisitionModes
          label={t("ticketModes")}
          modes={[
            {
              key: "PHOTO",
              disabled:
                tickets.length >= MAX_JOB_SCAN_ITEMS && !photos.photos.length,
              label: t("photoAi"),
              icon: Camera,
              pressed: panel === "PHOTO",
              onSelect: () => changePanel(panel === "PHOTO" ? null : "PHOTO"),
            },
            {
              key: "BARCODE",
              label: t("scanCode"),
              icon: ScanIcon,
              pressed: panel === "BARCODE",
              onSelect: () =>
                changePanel(panel === "BARCODE" ? null : "BARCODE"),
            },
            {
              key: "MANUAL",
              disabled: tickets.length >= MAX_JOB_SCAN_ITEMS,
              label: t("manual"),
              icon: Keyboard,
              onSelect: () => {
                if (acquisitionBlocked.current) return;
                // Keep collected photos mounted when adding a typed ticket.
                if (panelRef.current !== "PHOTO") changePanel(null);
                setTickets((current) =>
                  current.length >= MAX_JOB_SCAN_ITEMS
                    ? current
                    : [...current, newTicket("MANUAL")],
                );
              },
            },
          ]}
        />
        {panel === "PHOTO" && (
          <PhotoCapture
            selection={photos}
            onSubmit={(files) => {
              if (acquisitionBlocked.current) return false;
              if (
                ticketsRef.current.length + files.length >
                MAX_JOB_SCAN_ITEMS
              ) {
                setFeedback(t("groupLimit", { max: MAX_JOB_SCAN_ITEMS }));
                return false;
              }
              changePanel(null);
              // Every photo becomes its own ticket; the AI reads them all at once.
              files.forEach((file) => void onPhoto(file));
              return true;
            }}
          />
        )}
        {panel === "BARCODE" && !saving && (
          <ScanProgress tickets={tickets} written={lastWrite} />
        )}
        {panel === "BARCODE" && !saving && (
          <BarcodeCameraBox
            mode="PACKAGES"
            imageTarget="TICKET"
            onImageCodes={onImageCodes}
            onCode={onBarcode}
            // The pressed Scan code mode owns closing this panel.
            closeControl={false}
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
          !panel && <p className="text-sm text-muted">{t("noTickets")}</p>
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

      {tickets.length > 0 && (
        <StickyActionBar placement="responsive">
          <div className="mx-auto max-w-3xl">
            <Button
              className="min-h-12 w-full"
              disabled={Boolean(blocker) || saving}
              onClick={() => void submit()}
            >
              {saving ? t("saving") : t("save", { count: tickets.length })}
            </Button>
            <p role="status" className="mt-2 text-sm text-muted">
              {blocker ?? t("locationNotStock")}
            </p>
          </div>
        </StickyActionBar>
      )}
    </PageContainer>
  );
}
