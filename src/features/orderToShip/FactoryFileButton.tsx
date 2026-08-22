"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { Button } from "@/components/ui/button";
import { requestFactoryPacketFileAccessRef } from "@/lib/convex/orderToShipApi";

export function FactoryFileButton({
  warehouseId,
  factoryPacketId,
  masterCardFileId,
}: {
  readonly warehouseId: string;
  readonly factoryPacketId: string;
  readonly masterCardFileId: string;
}) {
  const environment = useAppEnvironment();
  const t = useTranslations("OrderToShip");
  if (!environment.backendConfigured || !environment.identityConfigured) {
    return (
      <Button type="button" variant="outline" disabled>
        {t("download")}
      </Button>
    );
  }
  return (
    <ServerFactoryFileButton
      warehouseId={warehouseId}
      factoryPacketId={factoryPacketId}
      masterCardFileId={masterCardFileId}
    />
  );
}

function ServerFactoryFileButton({
  warehouseId,
  factoryPacketId,
  masterCardFileId,
}: {
  readonly warehouseId: string;
  readonly factoryPacketId: string;
  readonly masterCardFileId: string;
}) {
  const t = useTranslations("OrderToShip");
  const requestAccess = useMutation(requestFactoryPacketFileAccessRef);
  const [notice, setNotice] = useState("");
  const open = async () => {
    const outcome = await requestAccess({
      warehouseId,
      factoryPacketId,
      masterCardFileId,
    });
    if (outcome.ok && outcome.value.granted) {
      window.open(outcome.value.url, "_blank", "noopener,noreferrer");
      setNotice(t("downloadGrantOpened"));
    } else {
      setNotice(t("fileAccessFailed"));
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <span role="status" className="text-xs text-muted">
        {notice}
      </span>
      <Button type="button" variant="outline" onClick={() => void open()}>
        {t("download")}
      </Button>
    </span>
  );
}
