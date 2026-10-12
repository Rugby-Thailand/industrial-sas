"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  useHrAccess,
  type HrSite,
} from "@/components/providers/HrAccessProvider";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { SelectControl } from "@/components/ui/SelectControl";
import { hrRefs } from "@/lib/convex/hrApi";

import {
  HrInterrupted,
  HrPager,
  HrSearchField,
  useHrPagedQuery,
} from "./HrPagedList";
import { useHrError } from "./HrShared";

const siteLabel = (site: { readonly code: string; readonly name: string }) =>
  `${site.code} · ${site.name}`;

export interface HrSiteSelectProps {
  readonly id: string;
  /** Names the paged picker's position; one per selector on a screen. */
  readonly surface: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly emptyLabel: string;
  /** Adds an "all sites" choice with the empty value. */
  readonly allLabel?: string;
  /** Closed sites too (period history). */
  readonly includeInactive?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  /** The preloaded sites to offer; defaults to the HR access sites. */
  readonly sites?: readonly HrSite[];
}

/**
 * A site choice over every site the actor may use. While the preloaded
 * site list is complete it is a plain select of those sites; when the
 * actor's sites exceed it (`sitesComplete: false`) the choices come from
 * the searchable, paged `sitesPage`, so a site sorted 51st or later stays
 * choosable and a site chosen from a link keeps its label.
 */
export function HrSiteSelect(props: HrSiteSelectProps) {
  const access = useHrAccess();
  // The access preview contains active sites only; historical filters must
  // query the complete site options even when that active preview is complete.
  if (access.sitesComplete !== false && !props.includeInactive) {
    return (
      <SelectControl
        id={props.id}
        value={props.value}
        onValueChange={props.onChange}
        placeholder={props.placeholder}
        emptyLabel={props.emptyLabel}
        disabled={props.disabled ?? false}
        invalid={props.invalid ?? false}
        {...(props.describedBy === undefined
          ? {}
          : { describedBy: props.describedBy })}
        options={[
          ...(props.allLabel === undefined
            ? []
            : [{ value: "", label: props.allLabel }]),
          ...(props.sites ?? access.sites ?? []).map((site) => ({
            value: site.id,
            label: siteLabel(site),
          })),
        ]}
      />
    );
  }
  return <PagedSiteSelect {...props} />;
}

function PagedSiteSelect({
  id,
  surface,
  value,
  onChange,
  placeholder,
  emptyLabel,
  allLabel,
  includeInactive,
  disabled,
  invalid,
  describedBy,
  sites,
}: HrSiteSelectProps) {
  const t = useTranslations("Hr.sitePicker");
  const message = useHrError();
  const access = useHrAccess();
  const [search, setSearch] = useState("");
  // The site the picker opened with resolves exactly, wherever it sorts.
  const [initial] = useState(value);
  const { view, paging } = useHrPagedQuery(
    hrRefs.sitesPage,
    {
      ...(search === "" ? {} : { search }),
      ...(includeInactive ? { includeInactive: true } : {}),
      ...(initial === "" ? {} : { selectedId: initial }),
    },
    `site-picker:${surface}`,
  );
  // Labels of sites chosen from earlier pages or searches.
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      (sites ?? access.sites).map((site) => [site.id, siteLabel(site)]),
    ),
  );
  const ready = view.kind === "ready" && !view.updating;
  const shown = ready
    ? view.rows.map((site) => ({ value: site.id, label: siteLabel(site) }))
    : [];
  const selected =
    view.kind === "ready" && view.value.selected
      ? { [view.value.selected.id]: siteLabel(view.value.selected) }
      : {};
  const label = chosen[value] ?? selected[value];
  const options = [
    ...(allLabel === undefined ? [] : [{ value: "", label: allLabel }]),
    ...(value !== "" && !shown.some((entry) => entry.value === value)
      ? [{ value, label: label ?? t("selected") }]
      : []),
    ...shown,
  ];
  return (
    <div className="grid min-w-0 gap-2">
      <SelectControl
        id={id}
        value={value}
        onValueChange={(next) => {
          const entry = shown.find((candidate) => candidate.value === next);
          if (entry !== undefined)
            setChosen((current) => ({ ...current, [next]: entry.label }));
          onChange(next);
        }}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
        disabled={disabled ?? false}
        invalid={invalid ?? false}
        {...(describedBy === undefined ? {} : { describedBy })}
        // Choices of a previous page are not choosable while the next loads.
        pending={!ready && view.kind !== "refused" && view.kind !== "denied"}
        options={options}
      />
      <HrSearchField
        id={`${id}-search`}
        label={t("search")}
        placeholder={t("searchHint")}
        value={search}
        onSettled={setSearch}
        className="grid w-full gap-1"
      />
      {view.kind === "refused" || view.kind === "denied" ? (
        <p role="alert" className="text-xs text-danger">
          {message(view.kind === "refused" ? view.code : "NOT_FOUND")}
        </p>
      ) : null}
      {view.kind === "interrupted" ? (
        <HrInterrupted view={view} compact />
      ) : null}
      {ready && shown.length === 0 && search !== "" ? (
        <p className="text-xs text-muted" role="status">
          {t("noMatches")}
        </p>
      ) : null}
      <HrPager paging={paging} label={t("pagination")} />
    </div>
  );
}

/**
 * Several sites (an announcement audience). A complete preloaded site list
 * is shown as checkboxes; beyond it the checkboxes come from the paged,
 * searchable site list, and chosen sites off the current page stay listed
 * with their labels so they can be removed.
 */
export function HrSiteChecklist({
  surface,
  value,
  onChange,
  emptyLabel,
}: {
  readonly surface: string;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly emptyLabel: string;
}) {
  const access = useHrAccess();
  const toggle = (siteId: string, checked: boolean) =>
    onChange(
      checked
        ? [...value.filter((id) => id !== siteId), siteId]
        : value.filter((id) => id !== siteId),
    );
  if (access.sitesComplete !== false)
    return (
      <>
        {access.sites.map((site) => (
          <CheckboxField
            key={site.id}
            label={siteLabel(site)}
            checked={value.includes(site.id)}
            onChange={(event) => toggle(site.id, event.target.checked)}
          />
        ))}
        {access.sites.length === 0 ? (
          <p className="text-sm text-muted">{emptyLabel}</p>
        ) : null}
      </>
    );
  return (
    <PagedSiteChecklist
      surface={surface}
      value={value}
      toggle={toggle}
      emptyLabel={emptyLabel}
    />
  );
}

function PagedSiteChecklist({
  surface,
  value,
  toggle,
  emptyLabel,
}: {
  readonly surface: string;
  readonly value: readonly string[];
  readonly toggle: (siteId: string, checked: boolean) => void;
  readonly emptyLabel: string;
}) {
  const t = useTranslations("Hr.sitePicker");
  const message = useHrError();
  const access = useHrAccess();
  const [search, setSearch] = useState("");
  const { view, paging } = useHrPagedQuery(
    hrRefs.sitesPage,
    search === "" ? {} : { search },
    `site-checklist:${surface}`,
  );
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(access.sites.map((site) => [site.id, siteLabel(site)])),
  );
  const ready = view.kind === "ready" && !view.updating;
  const rows = ready ? view.rows : [];
  const offPage = value.filter((id) => !rows.some((site) => site.id === id));
  return (
    <div className="space-y-2">
      <HrSearchField
        id={`site-checklist-${surface}-search`}
        label={t("search")}
        placeholder={t("searchHint")}
        value={search}
        onSettled={setSearch}
        className="grid w-full gap-1 sm:w-64"
      />
      {offPage.length > 0 ? (
        <div className="space-y-1" data-testid="hr-site-checklist-chosen">
          <p className="text-xs text-muted">{t("chosenElsewhere")}</p>
          {offPage.map((id) => (
            <CheckboxField
              key={id}
              label={labels[id] ?? t("selected")}
              checked
              onChange={() => toggle(id, false)}
            />
          ))}
        </div>
      ) : null}
      {view.kind === "refused" || view.kind === "denied" ? (
        <p role="alert" className="text-xs text-danger">
          {message(view.kind === "refused" ? view.code : "NOT_FOUND")}
        </p>
      ) : view.kind === "interrupted" ? (
        <HrInterrupted view={view} compact />
      ) : (
        <div aria-busy={!ready} inert={!ready} className="space-y-1">
          {rows.map((site) => (
            <CheckboxField
              key={site.id}
              label={siteLabel(site)}
              checked={value.includes(site.id)}
              disabled={!ready}
              onChange={(event) => {
                setLabels((current) => ({
                  ...current,
                  [site.id]: siteLabel(site),
                }));
                toggle(site.id, event.target.checked);
              }}
            />
          ))}
          {ready && rows.length === 0 ? (
            <p className="text-sm text-muted">
              {search === "" ? emptyLabel : t("noMatches")}
            </p>
          ) : null}
        </div>
      )}
      <HrPager paging={paging} label={t("pagination")} />
    </div>
  );
}
