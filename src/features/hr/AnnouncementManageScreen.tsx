"use client";

import { useMutation, useQuery } from "convex/react";
import { Megaphone, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input, fieldControlClassName } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import {
  AnnouncementPager,
  AnnouncementState,
  AnnouncementTime,
  type AnnouncementRow,
} from "./AnnouncementsScreen";
import { HrGate, HrInlineError, useHrError, WriteFeedback } from "./HrShared";
import { useHrWrite } from "./useHrWrite";

interface AnnouncementPolicy {
  readonly config: {
    readonly announcementAudience: "SITE" | "ORGANIZATION";
    readonly announcementAcknowledgment: boolean;
  };
}
interface Draft {
  readonly _id?: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly audience: {
    readonly mode: "ORGANIZATION" | "SITES";
    readonly warehouseIds: readonly string[];
  };
  readonly pinned: boolean;
  readonly acknowledgmentRequired: boolean;
  readonly replacesId?: string;
}
export function HrAnnouncementManageScreen() {
  const t = useTranslations("Hr.announcements");
  return (
    <>
      <PageHeader
        title={t("manageTitle")}
        summary={t("manageSummary")}
        showBack={false}
      />
      <HrGate code={HR_CODES.admin}>
        <ManageContent />
      </HrGate>
    </>
  );
}
function ManageContent() {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(hrRefs.manageAnnouncements, {
    limit: 20,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <OutcomeGate outcome={outcome}>
      {({ value }) =>
        value.ok ? (
          <ManagePage
            result={value}
            cursors={cursors}
            setCursors={setCursors}
          />
        ) : (
          <HrInlineError code={value.code} />
        )
      }
    </OutcomeGate>
  );
}
function ManagePage({
  result,
  cursors,
  setCursors,
}: {
  readonly result: {
    readonly items: readonly AnnouncementRow[];
    readonly nextCursor: string | null;
    readonly policy: AnnouncementPolicy | null;
  };
  readonly cursors: readonly string[];
  readonly setCursors: (value: string[]) => void;
}) {
  const t = useTranslations("Hr.announcements");
  const [editor, setEditor] = useState<Draft | null>(null);
  const [receiptsId, setReceiptsId] = useState<string | null>(null);
  const create = () =>
    setEditor({
      version: 0,
      title: "",
      body: "",
      audience: {
        mode:
          result.policy?.config.announcementAudience === "ORGANIZATION"
            ? "ORGANIZATION"
            : "SITES",
        warehouseIds: [],
      },
      acknowledgmentRequired:
        result.policy?.config.announcementAcknowledgment ?? false,
      pinned: false,
    });
  return (
    <div className="space-y-section">
      {!result.policy ? (
        <Notice
          tone="warning"
          title={t("policyGate")}
          body={t("policyGateHint")}
        />
      ) : null}
      <SectionHeader
        title={t("allAnnouncements")}
        actions={
          <Button disabled={editor !== null} onClick={create}>
            <Plus aria-hidden="true" />
            {t("newDraft")}
          </Button>
        }
      />
      {editor ? (
        <AnnouncementEditor
          key={editor._id ?? editor.replacesId ?? "new"}
          initial={editor}
          policy={result.policy}
          close={() => setEditor(null)}
        />
      ) : null}
      {result.items.length ? (
        <ul className="space-y-3">
          {result.items.map((row) => (
            <li key={row._id}>
              <Panel className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold wrap-anywhere text-text">
                      {row.title}
                    </h2>
                    <p className="text-xs text-muted">
                      {t("contentVersion")}:{" "}
                      {row.publishedVersion ?? row.version} ·{" "}
                      <AnnouncementTime at={row.publishedAt} />
                    </p>
                  </div>
                  <AnnouncementState row={row} />
                </div>
                {row.status === "SCHEDULED" ? (
                  <ScheduledActions row={row} />
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      disabled={editor !== null}
                      onClick={() =>
                        setEditor(
                          row.status === "DRAFT"
                            ? row
                            : {
                                title: row.title,
                                body: row.body,
                                pinned: row.pinned,
                                audience: row.audience,
                                acknowledgmentRequired:
                                  row.acknowledgmentRequired,
                                version: 0,
                                replacesId: row._id,
                              },
                        )
                      }
                    >
                      {t(row.status === "DRAFT" ? "editDraft" : "revise")}
                    </Button>
                    {row.status !== "DRAFT" ? (
                      <Button
                        variant="outline"
                        onClick={() => setReceiptsId(row._id)}
                      >
                        {t("receipts")}
                      </Button>
                    ) : null}
                  </div>
                )}
                {row.status === "PUBLISHED" ? (
                  <PublishedActions row={row} />
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Megaphone />}
          title={t("emptyManage")}
          body={t("emptyManageHint")}
        />
      )}
      {editor ? null : (
        <AnnouncementPager
          cursors={cursors}
          nextCursor={result.nextCursor}
          setCursors={setCursors}
        />
      )}
      {receiptsId ? (
        <AnnouncementReceipts
          key={receiptsId}
          announcementId={receiptsId}
          close={() => setReceiptsId(null)}
        />
      ) : null}
    </div>
  );
}
function AnnouncementEditor({
  initial,
  policy,
  close,
}: {
  readonly initial: Draft;
  readonly policy: AnnouncementPolicy | null;
  readonly close: () => void;
}) {
  const t = useTranslations("Hr.announcements");
  const access = useHrAccess();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const save = useMutation(hrRefs.saveAnnouncementDraft);
  const publish = useMutation(hrRefs.publishAnnouncement);
  const schedule = useMutation(hrRefs.scheduleAnnouncement);
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("09:00");
  const write = useHrWrite<{
    written: true;
    documentId: string;
    version: number;
  }>(`announcement-editor:${initial._id ?? initial.replacesId ?? "new"}`);
  const lastAction = useRef<"SAVE" | "PUBLISH" | "SCHEDULE">("SAVE");
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDraftGuard(
    (dirty || publishDate !== "" || publishTime !== "09:00") && !write.locked,
    () => {
      setDraft(baseline);
      setPublishDate("");
      setPublishTime("09:00");
    },
    write.pending,
  );
  const id = useId();
  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setInvalid(false);
  };
  const afterSave = (value: { documentId: string; version: number }) => {
    if (
      typeof value.documentId !== "string" ||
      !Number.isSafeInteger(value.version)
    )
      return;
    const next = { ...draft, _id: value.documentId, version: value.version };
    setBaseline(next);
    setDraft(next);
  };
  const submit = async () => {
    if (
      !draft.title.trim() ||
      !draft.body.trim() ||
      (draft.audience.mode === "SITES" &&
        draft.audience.warehouseIds.length === 0)
    ) {
      setInvalid(true);
      return;
    }
    lastAction.current = "SAVE";
    const result = await write.submit((requestId) =>
      save({
        requestId,
        ...(baseline._id ? { announcementId: baseline._id } : {}),
        expectedVersion: baseline.version,
        title: draft.title,
        body: draft.body,
        audience: {
          mode: draft.audience.mode,
          warehouseIds: [...draft.audience.warehouseIds],
        },
        acknowledgmentRequired: draft.acknowledgmentRequired,
        pinned: draft.pinned,
        ...(draft.replacesId ? { replacesId: draft.replacesId } : {}),
      }),
    );
    if (result.kind === "SAVED") afterSave(result.value);
  };
  return (
    <Panel className="space-y-group">
      <SectionHeader
        title={t(draft.replacesId ? "revisionTitle" : "draftTitle")}
        description={draft.replacesId ? t("revisionHint") : t("draftHint")}
      />
      <form
        className="space-y-group"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField id={`${id}-title`} label={t("fieldTitle")} required>
          {(field) => (
            <Input
              id={field.id}
              value={draft.title}
              maxLength={200}
              required
              disabled={write.locked}
              onChange={(event) => update({ title: event.target.value })}
            />
          )}
        </FormField>
        <FormField id={`${id}-body`} label={t("fieldBody")} required>
          {(field) => (
            <textarea
              id={field.id}
              className={`${fieldControlClassName} min-h-48`}
              value={draft.body}
              maxLength={12000}
              required
              disabled={write.locked}
              onChange={(event) => update({ body: event.target.value })}
            />
          )}
        </FormField>
        <FormField id={`${id}-audience`} label={t("audience")} required>
          {(field) => (
            <SelectControl
              id={field.id}
              value={draft.audience.mode}
              options={[
                { value: "SITES", label: t("audienceSites") },
                ...(policy?.config.announcementAudience === "SITE"
                  ? []
                  : [{ value: "ORGANIZATION", label: t("audienceOrg") }]),
              ]}
              placeholder={t("audience")}
              emptyLabel={t("audienceSites")}
              disabled={write.locked}
              onValueChange={(mode) => {
                if (mode === "SITES" || mode === "ORGANIZATION")
                  update({ audience: { mode, warehouseIds: [] } });
              }}
            />
          )}
        </FormField>
        {draft.audience.mode === "SITES" ? (
          <fieldset disabled={write.locked} className="space-y-1">
            <legend className="text-sm font-medium text-text">
              {t("sites")}
            </legend>
            {access.sites.map((site) => (
              <CheckboxField
                key={site.id}
                label={`${site.code} · ${site.name}`}
                checked={draft.audience.warehouseIds.includes(site.id)}
                onChange={(event) =>
                  update({
                    audience: {
                      mode: "SITES",
                      warehouseIds: event.target.checked
                        ? [...draft.audience.warehouseIds, site.id]
                        : draft.audience.warehouseIds.filter(
                            (value) => value !== site.id,
                          ),
                    },
                  })
                }
              />
            ))}
            {access.sites.length === 0 ? (
              <p className="text-sm text-muted">{t("noSites")}</p>
            ) : null}
          </fieldset>
        ) : null}
        <CheckboxField
          label={t("pin")}
          checked={draft.pinned}
          disabled={write.locked}
          onChange={(event) => update({ pinned: event.target.checked })}
        />
        <CheckboxField
          label={t("requireAck")}
          checked={
            draft.acknowledgmentRequired ||
            policy?.config.announcementAcknowledgment === true
          }
          disabled={
            write.locked || policy?.config.announcementAcknowledgment === true
          }
          description={t("requireAckHint")}
          onChange={(event) =>
            update({ acknowledgmentRequired: event.target.checked })
          }
        />
        {invalid ? (
          <Notice tone="danger" role="alert" title={t("invalidDraft")} />
        ) : null}
        <WriteFeedback
          state={write.state}
          onRetry={() =>
            void write.retry().then((result) => {
              if (result.kind === "SAVED") {
                if (lastAction.current !== "SAVE") close();
                else afterSave(result.value);
              }
            })
          }
        />
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            pending={write.pending}
            disabled={write.locked || (!!baseline._id && !dirty)}
          >
            {t("saveDraft")}
          </Button>
          <Button
            type="button"
            disabled={!baseline._id || dirty || write.locked || !policy}
            variant="outline"
            onClick={() => {
              if (baseline._id) {
                lastAction.current = "PUBLISH";
                void write
                  .submit((requestId) =>
                    publish({
                      requestId,
                      announcementId: baseline._id!,
                      expectedVersion: baseline.version,
                    }),
                  )
                  .then((result) => {
                    if (result.kind === "SAVED") close();
                  });
              }
            }}
          >
            {t("publishSaved")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={write.locked}
            onClick={close}
          >
            {t("cancel")}
          </Button>
        </div>
        <fieldset className="space-y-3" disabled={write.locked}>
          <legend className="text-sm font-semibold text-text">
            {t("scheduleTitle")}
          </legend>
          <p className="text-sm text-muted">{t("scheduleHint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${id}-publish-date`} label={t("publishDate")}>
              {(field) => (
                <Input
                  id={field.id}
                  type="date"
                  value={publishDate}
                  min={access.today}
                  onChange={(event) => setPublishDate(event.target.value)}
                />
              )}
            </FormField>
            <FormField id={`${id}-publish-time`} label={t("publishTime")}>
              {(field) => (
                <Input
                  id={field.id}
                  type="time"
                  value={publishTime}
                  onChange={(event) => setPublishTime(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              !baseline._id ||
              dirty ||
              write.locked ||
              !policy ||
              !publishDate ||
              !publishTime
            }
            onClick={() => {
              const announcementId = baseline._id;
              if (!announcementId || dirty || !publishDate || !publishTime)
                return;
              lastAction.current = "SCHEDULE";
              void write
                .submit((requestId) =>
                  schedule({
                    requestId,
                    announcementId,
                    expectedVersion: baseline.version,
                    publishDate,
                    publishTime,
                  }),
                )
                .then((result) => {
                  if (result.kind === "SAVED") close();
                });
            }}
          >
            {t("scheduleSaved")}
          </Button>
        </fieldset>
        <p className="text-xs text-muted">
          {t(dirty ? "unsaved" : "publishHint")}
        </p>
      </form>
    </Panel>
  );
}
function ScheduledActions({ row }: { readonly row: AnnouncementRow }) {
  const t = useTranslations("Hr.announcements");
  const error = useHrError();
  const cancel = useMutation(hrRefs.cancelAnnouncementSchedule);
  const write = useHrWrite(`announcement-cancel-schedule:${row._id}`);
  usePendingGuard(write.pending);
  return (
    <div className="space-y-3">
      <p className="text-sm text-text">
        {t("scheduledFor")}: <AnnouncementTime at={row.publishAt} />
      </p>
      {row.scheduleError ? (
        <Notice
          tone="warning"
          title={t("scheduleFailed")}
          body={t("scheduleFailureHint")}
        >
          <p className="text-sm text-text">{error(row.scheduleError)}</p>
          <p className="text-xs text-muted">
            <AnnouncementTime at={row.scheduleFailedAt} />
          </p>
        </Notice>
      ) : null}
      <Button
        variant="outline"
        disabled={write.locked}
        pending={write.pending}
        onClick={() =>
          void write.submit((requestId) =>
            cancel({
              requestId,
              announcementId: row._id,
              expectedVersion: row.version,
            }),
          )
        }
      >
        {t("cancelSchedule")}
      </Button>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </div>
  );
}
function PublishedActions({ row }: { readonly row: AnnouncementRow }) {
  const t = useTranslations("Hr.announcements");
  const archive = useMutation(hrRefs.archiveAnnouncement);
  const pin = useMutation(hrRefs.setAnnouncementPinned);
  const write = useHrWrite(`announcement-admin:${row._id}`);
  usePendingGuard(write.pending);
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={write.locked}
          pending={write.pending}
          onClick={() =>
            void write.submit((requestId) =>
              pin({
                requestId,
                announcementId: row._id,
                expectedVersion: row.version,
                pinned: !row.pinned,
              }),
            )
          }
        >
          {t(row.pinned ? "unpin" : "pin")}
        </Button>
        <Button
          variant="outline"
          disabled={write.locked}
          onClick={() =>
            void write.submit((requestId) =>
              archive({
                requestId,
                announcementId: row._id,
                expectedVersion: row.version,
              }),
            )
          }
        >
          {t("archive")}
        </Button>
      </div>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </>
  );
}
function AnnouncementReceipts({
  announcementId,
  close,
}: {
  readonly announcementId: string;
  readonly close: () => void;
}) {
  const t = useTranslations("Hr.announcements");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(hrRefs.announcementReceipts, {
    announcementId,
    limit: 20,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <Panel className="space-y-group">
      <SectionHeader
        title={t("receipts")}
        description={t("receiptsHint")}
        actions={
          <Button variant="ghost" onClick={close}>
            {t("close")}
          </Button>
        }
      />
      <OutcomeGate outcome={outcome}>
        {({ value }) =>
          value.ok ? (
            <>
              <p className="text-sm text-muted">
                {t("recipientCount", { count: value.recipientCount })}
              </p>
              <ul className="divide-y divide-border">
                {value.items.map((row: AnnouncementReceiptRow) => (
                  <li key={row._id} className="space-y-2 py-3">
                    <p className="font-medium text-text">
                      {row.employeeCode} · {row.employeeName}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <StatusBadge
                        tone={row.readAt ? "muted" : "accent"}
                        label={t(row.readAt ? "read" : "unread")}
                      />
                      <AnnouncementTime at={row.readAt} />
                      <StatusBadge
                        tone={row.acknowledgedAt ? "success" : "muted"}
                        label={t(
                          row.acknowledgedAt
                            ? "acknowledged"
                            : "notAcknowledged",
                        )}
                      />
                      <AnnouncementTime at={row.acknowledgedAt} />
                    </div>
                  </li>
                ))}
              </ul>
              <AnnouncementPager
                cursors={cursors}
                nextCursor={value.nextCursor}
                setCursors={setCursors}
              />
            </>
          ) : (
            <HrInlineError code={value.code} />
          )
        }
      </OutcomeGate>
    </Panel>
  );
}
interface AnnouncementReceiptRow {
  readonly _id: string;
  readonly employeeName: string;
  readonly employeeCode: string;
  readonly readAt?: number;
  readonly acknowledgedAt?: number;
}
