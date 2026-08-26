"use client";

import {
  CloudUploadIcon,
  FileIcon,
  ImageIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";

import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload";
import { cn } from "@/lib/utils";

interface PrivateFileUploadProps {
  readonly accept: string;
  readonly maxSize: number;
  readonly disabled?: boolean;
  readonly showLimit?: boolean;
  readonly resetKey: number;
  readonly labels: {
    readonly drop: string;
    readonly browse: string;
    readonly limit: string;
    readonly remove: string;
    readonly invalid: string;
  };
  readonly onFileChange: (file: File | null) => void;
}

export function PrivateFileUpload({
  accept,
  maxSize,
  disabled = false,
  showLimit = true,
  resetKey,
  labels,
  onFileChange,
}: PrivateFileUploadProps) {
  return (
    <PrivateFileUploadState
      key={resetKey}
      accept={accept}
      maxSize={maxSize}
      disabled={disabled}
      showLimit={showLimit}
      labels={labels}
      onFileChange={onFileChange}
    />
  );
}

function PrivateFileUploadState({
  accept,
  maxSize,
  disabled,
  showLimit,
  labels,
  onFileChange,
}: Omit<PrivateFileUploadProps, "resetKey">) {
  const [state, actions] = useFileUpload({
    accept,
    maxSize,
    createPreviews: true,
    onFilesChange: (items) => {
      const source = items[0]?.file;
      onFileChange(source instanceof File ? source : null);
    },
  });
  const selected = state.files[0];
  const selectedIsImage = selected?.file.type.startsWith("image/") === true;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "group relative overflow-hidden rounded-xl border border-dashed border-border-strong bg-raised transition-all duration-200",
          state.isDragging &&
            "border-primary bg-primary/8 ring-3 ring-primary/15",
          disabled && "opacity-60",
        )}
        onDragEnter={actions.handleDragEnter}
        onDragLeave={actions.handleDragLeave}
        onDragOver={actions.handleDragOver}
        onDrop={actions.handleDrop}
      >
        <input
          {...actions.getInputProps({ disabled, "aria-label": labels.browse })}
          className="hidden"
          tabIndex={-1}
        />
        {selected === undefined ? (
          <button
            type="button"
            disabled={disabled}
            className="flex min-h-52 w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-xl p-6 text-center transition-colors hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none disabled:cursor-not-allowed"
            onClick={actions.openFileDialog}
          >
            <div className="rounded-full bg-primary/10 p-4 text-primary">
              <CloudUploadIcon aria-hidden="true" className="size-8" />
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-text">{labels.drop}</p>
              {showLimit ? (
                <p className="text-xs leading-relaxed text-muted">
                  {labels.limit}
                </p>
              ) : null}
            </div>
            <span className="text-sm font-medium text-primary">
              {labels.browse}
            </span>
          </button>
        ) : (
          <div className="relative min-h-52">
            {selectedIsImage && selected.preview !== undefined ? (
              <div className="relative aspect-4/3 min-h-52 w-full bg-black/5">
                <Image
                  src={selected.preview}
                  alt={selected.file.name}
                  fill
                  unoptimized
                  className="object-contain"
                />
              </div>
            ) : (
              <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="rounded-full bg-primary/10 p-4 text-primary">
                  <FileIcon aria-hidden="true" className="size-8" />
                </div>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-linear-to-t from-black/80 via-black/45 to-transparent p-4 pt-12 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {selected.file.name}
                </p>
                <p className="text-xs text-white/75">
                  {formatBytes(selected.file.size)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  disabled={disabled}
                  aria-label={labels.browse}
                  onClick={actions.openFileDialog}
                >
                  {selectedIsImage ? (
                    <ImageIcon aria-hidden="true" className="size-4" />
                  ) : (
                    <UploadIcon aria-hidden="true" className="size-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  disabled={disabled}
                  aria-label={labels.remove}
                  onClick={() => actions.removeFile(selected.id)}
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      {state.errors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>{labels.invalid}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
