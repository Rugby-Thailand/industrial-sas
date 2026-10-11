"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { api } from "../../../convex/_generated/api";
import { clientRef } from "@/lib/convex/clientRef";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/Panel";
import type { Settings } from "./report";

const configureRef = clientRef(api.aiUsage.reports.configure);

/** Versioned USD/THB rate, funding-fee estimate and rate source. */
export function SettingsForm({ settings }: { settings: Settings }) {
  const [open, setOpen] = useState(!settings);
  const t = useTranslations("AiUsage"),
    save = useMutation(configureRef);
  const [rate, setRate] = useState(settings ? String(settings.usdThbRate) : ""),
    [fee, setFee] = useState(settings ? String(settings.feePercent) : "5.5"),
    [source, setSource] = useState(settings?.source ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    try {
      const result = await save({
        usdThbRate: Number(rate),
        feePercent: Number(fee),
        source,
      });
      setState(result.ok && result.value.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  }
  return (
    <Panel>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="min-h-touch cursor-pointer font-semibold">
          {t("settings")}
        </summary>
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-muted">
          {t("settingsNote")}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField id="usage-fx" label={t("fx")} required>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0.000001"
                  max="1000"
                  step="any"
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value);
                    setState("idle");
                  }}
                  required
                  disabled={state === "saving"}
                />
              )}
            </FormField>
            <FormField id="usage-fee" label={t("feePercent")} required>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={fee}
                  onChange={(e) => {
                    setFee(e.target.value);
                    setState("idle");
                  }}
                  required
                  disabled={state === "saving"}
                />
              )}
            </FormField>
            <FormField id="usage-source" label={t("source")} required>
              {(props) => (
                <Input
                  {...props}
                  value={source}
                  maxLength={160}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setState("idle");
                  }}
                  required
                  disabled={state === "saving"}
                />
              )}
            </FormField>
          </div>
          <Button type="submit" disabled={state === "saving"}>
            {t(state === "saving" ? "saving" : "save")}
          </Button>
          {state === "error" || state === "saved" ? (
            <p
              role="status"
              className={
                state === "error"
                  ? "text-sm text-danger"
                  : "text-sm text-success"
              }
            >
              {t(state === "error" ? "settingsError" : "saved")}
            </p>
          ) : null}
        </form>
      </details>
    </Panel>
  );
}
