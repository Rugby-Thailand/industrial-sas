"use client";

/**
 * The operator's first screen: **My work**, the site queue, and the two
 * controls that move a task between them (`FF-P1-01`, `FF-P1-09`).
 *
 * Three things this screen does that a task list would not:
 *
 * 1. **It says who holds what, in words and with time left.** The lease is
 *    computed server-side and sent as a decided fact, so a handheld whose clock
 *    is minutes out cannot render "4 min left" for a task it has already lost.
 * 2. **It shows how much partial work a task already carries.** A lapsed lease
 *    with twelve scans on it is a different proposition from an untouched one,
 *    and the evidence count is what makes an operator pick the right task.
 * 3. **It tells the operator what the connection permits *before* they press.**
 *    Claiming and releasing are `BLOCKED_OFFLINE`
 *    (`convex/model/platform/commandClassification.ts`), so while the link is
 *    down the controls are disabled with the reason rather than offered and
 *    then refused.
 */
import { useConvexConnectionState } from "convex/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { OperatorTaskTable } from "@/components/operator/OperatorTaskTable";
import { OperatorTaskHeader } from "@/components/operator/OperatorTaskHeader";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { Notice } from "@/components/ui/Notice";
import {
  classifyConnection,
  type ConnectionStatus,
} from "@/lib/convex/connection";
import {
  claimOperatorTaskRef,
  listOperatorTasksRef,
  releaseOperatorTaskRef,
  type OperatorTaskRow,
} from "@/lib/convex/platformApi";
import {
  availabilityFor,
  type CommandAvailability,
} from "@/lib/offline/commandAvailability";
import {
  PREVIEW_OPERATOR_USER_ID,
  previewOperatorTasksFor,
} from "@/lib/preview/operatorWorkPreview";

import { MasterDataPanel } from "../masterData/MasterDataPanel";
import { RowActionButton, RowWriteRegion } from "../masterData/RowWriteRegion";
import { TaskAttachmentPanel } from "./TaskAttachmentPanel";
import { TaskEvidenceTimeline } from "./TaskEvidenceTimeline";
import { TaskExceptionSheet } from "./TaskExceptionSheet";
import { TaskQuantityEvidence } from "./TaskQuantityEvidence";
import { TaskScanEvidence } from "./TaskScanEvidence";

/** What the board is showing: this operator's work, or the whole site. */
export type WorkScope = "MINE" | "SITE";

/**
 * Resolve the shell's connection status without assuming a Convex client.
 *
 * `useConvexConnectionState` throws outside a provider, and there is no
 * provider on an unconfigured machine or in preview mode — the same split
 * `ConnectionIndicator` makes, for the same reason, so the board renders in
 * preview without a socket.
 */
function WithConnectionStatus({
  children,
}: {
  readonly children: (status: ConnectionStatus) => ReactNode;
}): ReactNode {
  const environment = useAppEnvironment();
  if (environment.previewMode || !environment.backendConfigured) {
    return <>{children(classifyConnection(environment, undefined))}</>;
  }
  return <LiveConnectionStatus>{children}</LiveConnectionStatus>;
}

function LiveConnectionStatus({
  children,
}: {
  readonly children: (status: ConnectionStatus) => ReactNode;
}): ReactNode {
  const environment = useAppEnvironment();
  const connection = useConvexConnectionState();
  return (
    <>
      {children(
        classifyConnection(environment, {
          isWebSocketConnected: connection.isWebSocketConnected,
          hasEverConnected: connection.hasEverConnected,
        }),
      )}
    </>
  );
}

export function OperatorWorkBoard() {
  return (
    <WithConnectionStatus>
      {(status) => <WorkBoardBody status={status} />}
    </WithConnectionStatus>
  );
}

function WorkBoardBody({ status }: { readonly status: ConnectionStatus }) {
  const t = useTranslations("OperatorWork");
  const environment = useAppEnvironment();
  const [scope, setScope] = useState<WorkScope>("MINE");
  const [selectedTask, setSelectedTask] = useState<OperatorTaskRow>();
  /*
   * Claim and release are both `BLOCKED_OFFLINE`, so one verdict covers both
   * controls. If they ever diverge, this becomes two and the screen says so per
   * control rather than by implication.
   */
  const availability: CommandAvailability = availabilityFor({
    operation: "work.task.claim",
    status,
  });

  return (
    <section className="flex flex-col gap-4" data-testid="operator-work-board">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t("scopeLabel")}
      >
        {(["MINE", "SITE"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={scope === candidate}
            onClick={() => {
              setScope(candidate);
              setSelectedTask(undefined);
            }}
            data-testid={`work-scope-${candidate}`}
            className={`min-h-12 rounded-lg border px-4 text-sm font-semibold ${
              scope === candidate
                ? "border-accent text-accent"
                : "border-border text-muted"
            }`}
          >
            {candidate === "MINE" ? t("scopeMine") : t("scopeSite")}
          </button>
        ))}
      </div>

      {availability.available ? null : (
        <Notice
          tone="warning"
          role="status"
          testId="work-offline-notice"
          title={t("offlineTitle")}
          body={t(
            `blockReason.${availability.reasonCode ?? "commandNotClassified"}`,
          )}
        />
      )}

      <MasterDataPanel<
        OperatorTaskRow,
        {
          warehouseId: string;
          scope?: WorkScope;
          maxPageSize?: number;
          cursor?: string;
        }
      >
        // The cursor belongs to the query that produced it, and switching scope
        // switches the index the page came from.
        key={scope}
        queryRef={listOperatorTasksRef}
        scope="WAREHOUSE"
        buildArgs={({ warehouseId, cursor }) => ({
          warehouseId,
          scope,
          ...(cursor === undefined ? {} : { cursor }),
        })}
        previewRowsFor={previewOperatorTasksFor}
        renderRows={(rows) => (
          <div className="flex flex-col gap-4">
            <RowWriteRegion mutationRef={claimOperatorTaskRef}>
              {({ submit, busy }) => (
                <OperatorTaskTable
                  rows={rows}
                  {...(environment.previewMode
                    ? { currentUserId: PREVIEW_OPERATOR_USER_ID }
                    : {})}
                  renderAction={(row) => {
                    if (
                      scope === "MINE" &&
                      row.status === "CLAIMED" &&
                      row.lease.kind === "HELD"
                    ) {
                      return (
                        <RowActionButton
                          busy={false}
                          testId={`work-open-${row.operatorTaskId}`}
                          label={
                            selectedTask?.operatorTaskId === row.operatorTaskId
                              ? t("closeTask")
                              : t("openTask")
                          }
                          onClick={() =>
                            setSelectedTask((current) =>
                              current?.operatorTaskId === row.operatorTaskId
                                ? undefined
                                : row,
                            )
                          }
                        />
                      );
                    }
                    return row.status === "COMPLETED" ||
                      row.status === "CANCELLED" ? (
                      <span className="text-xs text-muted">
                        {t("noAction")}
                      </span>
                    ) : (
                      <RowActionButton
                        busy={busy || !availability.available}
                        testId={`work-claim-${row.operatorTaskId}`}
                        label={
                          row.lease.kind === "EXPIRED"
                            ? t("takeOver")
                            : t("claim")
                        }
                        {...(availability.available
                          ? row.lease.kind === "EXPIRED"
                            ? { title: t("takeOverHint") }
                            : {}
                          : {
                              title: t(
                                `blockReason.${availability.reasonCode ?? "commandNotClassified"}`,
                              ),
                            })}
                        onClick={() =>
                          submit(row.operatorTaskId, (requestId) => ({
                            requestId,
                            warehouseId: row.warehouseId,
                            operatorTaskId: row.operatorTaskId,
                          }))
                        }
                      />
                    );
                  }}
                />
              )}
            </RowWriteRegion>

            {selectedTask === undefined ? null : (
              <div className="flex flex-col gap-4">
                <OperatorTaskHeader
                  task={selectedTask}
                  connectionStatus={status}
                />
                <TaskScanEvidence
                  task={selectedTask}
                  connectionStatus={status}
                />
                <TaskQuantityEvidence
                  task={selectedTask}
                  connectionStatus={status}
                />
                <TaskEvidenceTimeline task={selectedTask} />
                <TaskAttachmentPanel
                  task={selectedTask}
                  connectionStatus={status}
                />
                <TaskExceptionSheet
                  task={selectedTask}
                  connectionStatus={status}
                />
              </div>
            )}
          </div>
        )}
      />
    </section>
  );
}

/**
 * Hand a task back, with the reason the release needs.
 *
 * A separate control rather than a row action: a release requires a reason, and
 * a reason typed into a table row is a reason nobody reads. The reason is
 * required by the server too, so the field is not decoration.
 */
export function ReleaseTaskForm({
  operatorTaskId,
  warehouseId,
}: {
  readonly operatorTaskId: string;
  readonly warehouseId: string;
}) {
  const t = useTranslations("OperatorWork");
  const [reason, setReason] = useState("");

  return (
    <RowWriteRegion mutationRef={releaseOperatorTaskRef}>
      {({ submit, busy }) => (
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`release-reason-${operatorTaskId}`}
            className="text-xs font-semibold text-muted"
          >
            {t("releaseReasonLabel")}
          </label>
          <input
            id={`release-reason-${operatorTaskId}`}
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="release-reason"
            className="min-h-12 rounded-lg border border-border bg-surface px-3 text-sm"
          />
          <RowActionButton
            busy={busy || reason.trim().length === 0}
            testId="work-release"
            label={t("release")}
            title={t("releaseHint")}
            onClick={() =>
              submit(operatorTaskId, (requestId) => ({
                requestId,
                warehouseId,
                operatorTaskId,
                reason,
              }))
            }
          />
        </div>
      )}
    </RowWriteRegion>
  );
}
