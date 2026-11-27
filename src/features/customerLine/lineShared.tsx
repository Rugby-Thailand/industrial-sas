"use client";

import { useQuery } from "convex/react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
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

export function GroupStateBadge({ state }: { readonly state: LineGroupState }) {
  const t = useTranslations("CustomerLine");
  return (
    <StatusBadge
      tone={GROUP_STATE_TONE[state]}
      label={t(`groupState.${state}`)}
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
  defaultOpen = false,
}: {
  readonly basicId: string;
  readonly defaultOpen?: boolean;
}) {
  const t = useTranslations("CustomerLine");
  const fieldId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const inviteText = t("inviteMessage", { basicId });

  async function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(inviteText);
        setCopyMessage(t("copied"));
        return;
      } catch {
        // Fallback to selecting the readonly text below.
      }
    }
    textareaRef.current?.focus();
    textareaRef.current?.select();
    setCopyMessage(t("copyFallbackSelected"));
  }

  const content = (
    <div className="space-y-2.5" data-testid="line-invite-instructions">
      <p className="text-xs leading-relaxed text-muted">{t("inviteHint")}</p>
      <label htmlFor={fieldId} className="sr-only">
        {t("inviteLabel")}
      </label>
      <textarea
        ref={textareaRef}
        id={fieldId}
        readOnly
        rows={2}
        value={inviteText}
        className="w-full rounded-md border border-input bg-raised px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
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

  if (defaultOpen) {
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
