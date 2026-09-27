"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Camera,
  CheckCircle2,
  Keyboard,
  MapPin,
  ScanBarcode,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/PageContainer";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
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
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import { LocationPicker } from "./LocationPicker";
import { PhotoCapture } from "./PhotoCapture";
import { TicketCard } from "./TicketCard";
import { resizeImage, toDataUrl } from "./resizeImage";
import {
  applyBarcode,
  classifyTicketBarcode,
  isComplete,
  mergeExtracted,
  newTicket,
  toPayload,
  type PickedLocation,
  type TicketDraft,
} from "./ticketDraft";

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
  const [feedback, setFeedback] = useState<string>();
  const [saved, setSaved] = useState<{
    count: number;
    location: PickedLocation;
  }>();
  const [saving, setSaving] = useState(false);
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

  async function onPhoto(file: File) {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    const ticket = {
      ...newTicket("AI"),
      status: "reading" as const,
      previewUrl,
    };
    setTickets((current) => [...current, ticket]);
    const image = await resizeImage(file);
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
    setTickets((current) => applyBarcode(current, code).tickets);
    setFeedback(
      t("barcodeAdded", { field: t(classifyTicketBarcode(code)), code }),
    );
  }

  async function submit() {
    if (!location) return;
    setSaving(true);
    const result = await operation.run(async () =>
      written(
        await save({
          warehouseId,
          requestId: crypto.randomUUID(),
          locationText: location.text,
          ...(location.zoneId
            ? {
                location: {
                  zoneId: location.zoneId,
                  ...(location.supportPositionId
                    ? { supportPositionId: location.supportPositionId }
                    : {}),
                },
              }
            : {}),
          items: tickets.map(toPayload),
        }),
      ),
    );
    setSaving(false);
    if (result === null) return;
    tickets.forEach(releasePreview);
    setSaved({ count: tickets.length, location });
    setTickets([]);
    setPanel(null);
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
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button className="min-h-12" onClick={() => setSaved(undefined)}>
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
          <LocationPicker warehouseId={warehouseId} onPick={setLocation} />
        </Panel>
      </PageContainer>
    );

  const reading = tickets.some((ticket) => ticket.status === "reading");
  const incomplete = tickets.some((ticket) => !isComplete(ticket));
  const blocker = reading
    ? t("waitReading")
    : incomplete
      ? t("saveBlocked")
      : null;

  return (
    <PageContainer size="form" actionInset="fixed">
      <Heading title={t("title")} />
      <div className="-mt-4 flex min-h-11 items-center gap-2 text-sm">
        <MapPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="shrink-0 font-mono font-semibold">
          {location.code ?? location.text}
        </span>
        {location.name && (
          <span className="min-w-0 truncate text-muted">{location.name}</span>
        )}
        <StatusBadge
          tone={location.zoneId ? "success" : "warning"}
          label={location.zoneId ? t("mapped") : t("unmapped")}
        />
        <button
          type="button"
          className="ml-auto min-h-11 shrink-0 px-1 font-semibold text-link hover:underline disabled:text-disabled"
          disabled={saving}
          onClick={() => setLocation(undefined)}
        >
          {t("change")}
        </button>
      </div>

      <section className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant={panel === "PHOTO" ? "default" : "outline"}
            className="min-h-11 gap-1.5 px-2"
            aria-pressed={panel === "PHOTO"}
            onClick={() =>
              setPanel((open) => (open === "PHOTO" ? null : "PHOTO"))
            }
          >
            <Camera className="size-4" aria-hidden="true" />
            {t("photo")}
          </Button>
          <Button
            variant={panel === "BARCODE" ? "default" : "outline"}
            className="min-h-11 gap-1.5 px-2"
            aria-pressed={panel === "BARCODE"}
            onClick={() => {
              setFeedback(undefined);
              setPanel((open) => (open === "BARCODE" ? null : "BARCODE"));
            }}
          >
            <ScanBarcode className="size-4" aria-hidden="true" />
            {t("barcode")}
          </Button>
          <Button
            variant="outline"
            className="min-h-11 gap-1.5 px-2"
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
            onClose={() => setPanel(null)}
            onSubmit={(files) => {
              setPanel(null);
              // Every photo becomes its own ticket; the AI reads them all at once.
              files.forEach((file) => void onPhoto(file));
            }}
          />
        )}
        {panel === "BARCODE" && (
          <BarcodeCameraBox
            mode="PACKAGES"
            onCode={onBarcode}
            onClose={() => setPanel(null)}
            feedback={feedback}
          />
        )}
        {tickets.length ? (
          <ol className="space-y-3">
            {tickets.map((ticket, index) => (
              <TicketCard
                key={ticket.key}
                ticket={ticket}
                index={index}
                onChange={(field, value) =>
                  update(ticket.key, (row) => ({
                    ...row,
                    values: { ...row.values, [field]: value },
                    aiFields: row.aiFields.filter((name) => name !== field),
                  }))
                }
                onRemove={() => {
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
      </section>
      <ErrorNotice message={operation.error} />

      <StickyActionBar placement="fixed">
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
