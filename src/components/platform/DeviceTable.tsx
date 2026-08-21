"use client";

/**
 * The device registry, as columns.
 *
 * `installationBound` is rendered as a word, not a tick: "bound" and "not
 * bound" are the two states an administrator acts on — the second means the app
 * has not been installed on that device yet — and a tick with no text is a
 * state only a sighted user who already knows the convention can read.
 */
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EntityTable } from "@/components/masterData/EntityTable";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { DeviceRow } from "@/lib/convex/platformApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { formatInstant } from "@/lib/formatters";
import type { AppLocale } from "@/i18n/routing";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  RETIRED: "muted",
};

export function DeviceTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly DeviceRow[];
  readonly renderAction?: (row: DeviceRow) => ReactNode;
}) {
  const t = useTranslations("DeviceRegistry");
  const typeT = useTranslations("DeviceType") as unknown as CodeTranslator;
  const statusT = useTranslations("DeviceStatus") as unknown as CodeTranslator;
  const locale = useLocale() as AppLocale;

  return (
    <EntityTable<DeviceRow>
      testId="table-devices"
      caption={t("caption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.deviceId}
      columns={[
        {
          key: "label",
          header: t("columnLabel"),
          rowHeader: true,
          render: (row) => row.label,
        },
        {
          key: "type",
          header: t("columnType"),
          render: (row) => codeLabel(typeT, row.deviceType),
        },
        {
          key: "status",
          header: t("columnStatus"),
          render: (row) => (
            <StatusBadge
              tone={STATUS_TONES[row.status] ?? "neutral"}
              label={codeLabel(statusT, row.status)}
            />
          ),
        },
        {
          key: "installation",
          header: t("columnInstallation"),
          render: (row) => (row.installationBound ? t("bound") : t("notBound")),
        },
        {
          key: "lastSeen",
          header: t("columnLastSeen"),
          monospace: true,
          /*
           * "Never" is a real answer and a different one from "a long time ago":
           * a device that has never checked in was registered but never used,
           * which is the state an administrator chases before a shift starts.
           */
          render: (row) =>
            row.lastSeenAt === undefined
              ? t("neverSeen")
              : formatInstant(row.lastSeenAt, locale),
        },
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnActions"), renderAction })}
    />
  );
}
