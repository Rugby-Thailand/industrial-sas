"use client";

import type { ReactNode } from "react";
import {
  Layers3,
  Maximize,
  MoreHorizontal,
  QrCode,
  RotateCw,
  Tags,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { StorageViewModeToggle } from "./StorageZoneVisualizer";
import type { useFloorMapCamera } from "./useFloorMapCamera";
import styles from "./FloorMap.module.css";

function DisplayOption({
  name,
  icon,
  onClick,
  disabled,
  pressed,
}: {
  name: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-11 w-full justify-start"
      aria-label={name}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
    >
      {icon}
      {name}
    </Button>
  );
}

export function FloorMapCameraControls({
  camera,
  hasPdCells,
  baseLabel,
  showLocationLabels,
  onLocationLabelsChange,
  children,
}: {
  camera: ReturnType<typeof useFloorMapCamera>;
  hasPdCells: boolean;
  baseLabel: string;
  showLocationLabels: boolean;
  onLocationLabelsChange: (show: boolean) => void;
  children: ReactNode;
}) {
  const t = useTranslations("StorageLayouts");
  return (
    <>
      <StorageViewModeToggle
        value={camera.view}
        onChange={camera.changeView}
        label={t("viewMode")}
        planLabel={t("planView")}
        threeDLabel={t("threeDView")}
      />
      <IconButton
        type="button"
        label={t("mapZoomOut")}
        onClick={camera.zoomOut}
        disabled={camera.zoom <= 1}
      >
        <ZoomOut />
      </IconButton>
      <IconButton
        type="button"
        label={t("mapZoomIn")}
        onClick={camera.zoomIn}
        disabled={camera.zoom >= 8}
      >
        <ZoomIn />
      </IconButton>
      <IconButton type="button" label={t("mapFit")} onClick={camera.fit}>
        <Maximize />
      </IconButton>
      <Popover.Root>
        <Popover.Trigger asChild>
          <IconButton type="button" label={t("mapDisplayOptions")}>
            <MoreHorizontal />
          </IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className={`${styles.theme} z-50 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg`}
          >
            <DisplayOption
              name={t("mapShowLocationLabels")}
              icon={<Tags />}
              onClick={() => onLocationLabelsChange(!showLocationLabels)}
              disabled={camera.view === "3d" && hasPdCells}
              pressed={showLocationLabels}
            />
            <DisplayOption
              name={t("mapShowPackages")}
              icon={<QrCode />}
              onClick={camera.togglePackages}
              disabled={camera.view === "3d"}
              pressed={camera.showPackages}
            />
            <DisplayOption
              name={t("mapRotate")}
              icon={<RotateCw />}
              onClick={camera.rotate}
              disabled={camera.view === "plan"}
            />
            <DisplayOption
              name={baseLabel}
              icon={<Layers3 />}
              onClick={camera.toggleReference}
              pressed={camera.reference}
            />
            {showLocationLabels && hasPdCells && camera.zoom < 2 && (
              <p className="px-3 py-2 text-xs text-muted">
                {t("floorZoomForLabels")}
              </p>
            )}
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
