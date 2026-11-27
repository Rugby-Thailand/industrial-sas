"use client";

import { useQuery } from "convex/react";
import { Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Input } from "@/components/ui/input";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import {
  customerLineRefs,
  type LineConnectionState,
  type LineContactState,
  type LineGroupState,
  type LineProviderDeparture,
  type LineQuestionState,
  type LineViewer,
} from "./lineApi";

export function useLineViewer(): {
  readonly loading: boolean;
  readonly deniedRequestId: string | null;
  readonly viewer: LineViewer | null;
} {
  const outcome = useQuery(customerLineRefs.viewer, {});
  if (outcome === undefined) {
    return { loading: true, deniedRequestId: null, viewer: null };
  }
  if (!outcome.ok) {
    return {
      loading: false,
      deniedRequestId: outcome.denial.requestId,
      viewer: null,
    };
  }
  return { loading: false, deniedRequestId: null, viewer: outcome.value };
}

const GROUP_STATE_TONE: Readonly<Record<LineGroupState, BadgeTone>> = {
  pending: "warning",
  active: "success",
  paused: "warning",
  disconnected: "muted",
};

export function GroupStateBadge({
  state,
  ignored = false,
}: {
  readonly state: LineGroupState;
  readonly ignored?: boolean;
}) {
  const t = useTranslations("CustomerLine");
  return (
    <StatusBadge
      tone={GROUP_STATE_TONE[state]}
      label={t(ignored ? "groupState.ignored" : `groupState.${state}`)}
    />
  );
}

const DEPARTURE_TONE: Readonly<Record<LineProviderDeparture, BadgeTone>> = {
  pending: "pending",
  left: "muted",
  failed: "danger",
};

export function ProviderDepartureBadge({
  departure,
}: {
  readonly departure: LineProviderDeparture;
}) {
  const t = useTranslations("CustomerLine");
  return (
    <StatusBadge
      tone={DEPARTURE_TONE[departure]}
      label={t(`providerDeparture.${departure}`)}
    />
  );
}

const QUESTION_STATE_TONE: Readonly<Record<LineQuestionState, BadgeTone>> = {
  open: "accent",
  queued: "pending",
  accepted: "success",
  failed: "danger",
  unknown: "warning",
  canceled: "muted",
};

export function QuestionStateBadge({
  state,
}: {
  readonly state: LineQuestionState;
}) {
  const t = useTranslations("CustomerLine");
  return (
    <StatusBadge
      tone={QUESTION_STATE_TONE[state]}
      label={t(`questionState.${state}`)}
    />
  );
}

const CONTACT_STATE_TONE: Readonly<Record<LineContactState, BadgeTone>> = {
  observed: "neutral",
  verified: "success",
  revoked: "danger",
  left: "muted",
};

export function ContactStateBadge({
  state,
}: {
  readonly state: LineContactState;
}) {
  const t = useTranslations("CustomerLine");
  return (
    <StatusBadge
      tone={CONTACT_STATE_TONE[state]}
      label={t(`contactState.${state}`)}
    />
  );
}

const CONNECTION_STATE_TONE: Readonly<Record<LineConnectionState, BadgeTone>> =
  {
    setup: "warning",
    active: "success",
    disconnected: "muted",
  };

export function ConnectionStateBadge({
  state,
}: {
  readonly state: LineConnectionState;
}) {
  const t = useTranslations("CustomerLine");
  return (
    <StatusBadge
      tone={CONNECTION_STATE_TONE[state]}
      label={t(`connectionState.${state}`)}
    />
  );
}

export function InviteInstructions({
  basicId,
  showExpanded = false,
}: {
  readonly basicId: string;
  readonly showExpanded?: boolean;
}) {
  const t = useTranslations("CustomerLine");
  const fieldId = useId();
  const idRef = useRef<HTMLInputElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const profileUrl = `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;

  async function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(basicId);
        setCopyMessage(t("copied"));
        return;
      } catch {
        // Leave the ID selected for manual copying.
      }
    }
    idRef.current?.focus();
    idRef.current?.select();
    setCopyMessage(t("copyFallbackSelected"));
  }

  const content = (
    <div className="space-y-2.5" data-testid="line-invite-instructions">
      <p className="text-sm leading-relaxed text-muted">
        {t("inviteHint", { basicId })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={profileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" className="size-4" />
            {t("openBotInLine")}
          </a>
        </Button>
        <label htmlFor={fieldId} className="sr-only">
          {t("inviteLabel")}
        </label>
        <Input
          readOnly
          ref={idRef}
          id={fieldId}
          value={basicId}
          className="w-44 max-w-full font-mono"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void handleCopy()}
          data-testid="copy-invite-button"
        >
          <Copy aria-hidden="true" className="size-4" />
          {t("copyInvite")}
        </Button>
        <span role="status" className="text-xs text-muted">
          {copyMessage}
        </span>
      </div>
    </div>
  );

  if (showExpanded) {
    return (
      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base leading-6 font-semibold text-text">
          {t("inviteTitle")}
        </h2>
        {content}
      </section>
    );
  }

  return (
    <CollapsibleSection
      label={t("inviteTitle")}
      testId="line-invite-collapsible"
    >
      {content}
    </CollapsibleSection>
  );
}
