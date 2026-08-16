"use client";

import { FileIcon, ImageIcon, UploadIcon, XIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import {
  formatBytes,
  useFileUpload,
  type FileWithPreview,
} from "@/hooks/use-file-upload";
import { cn } from "@/lib/utils";

interface PrivateFileUploadProps {
  readonly accept: string;
  readonly maxSize: number;
  readonly disabled?: boolean;
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

function SelectedFile({ item }: { readonly item: FileWithPreview }) {
  const image = item.file.type.startsWith("image/");
  return (
    <div className="flex min-w-0 items-center gap-3">
      {image ? (
        <ImageIcon aria-hidden="true" className="size-5 shrink-0" />
      ) : (
        <FileIcon aria-hidden="true" className="size-5 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block truncate font-semibold text-text">
          {item.file.name}
        </span>
        <span className="text-xs text-muted">
          {formatBytes(item.file.size)}
        </span>
      </span>
    </div>
  );
}

export function PrivateFileUpload({
  accept,
  maxSize,
  disabled = false,
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
      labels={labels}
      onFileChange={onFileChange}
    />
  );
}

function PrivateFileUploadState({
  accept,
  maxSize,
  disabled,
  labels,
  onFileChange,
}: Omit<PrivateFileUploadProps, "resetKey">) {
  const [state, actions] = useFileUpload({
    accept,
    maxSize,
    createPreviews: false,
    onFilesChange: (items) => {
      const source = items[0]?.file;
      onFileChange(source instanceof File ? source : null);
    },
  });
  const selected = state.files[0];

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-lg border border-dashed border-border-strong bg-raised p-4 transition-colors",
          state.isDragging && "border-primary bg-primary/5",
          disabled && "opacity-60",
        )}
        onDragEnter={actions.handleDragEnter}
        onDragLeave={actions.handleDragLeave}
        onDragOver={actions.handleDragOver}
        onDrop={actions.handleDrop}
      >
        <input
          {...actions.getInputProps({ disabled, "aria-label": labels.browse })}
          className="sr-only"
        />
        {selected === undefined ? (
          <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-semibold text-text">{labels.drop}</p>
              <p className="text-xs text-muted">{labels.limit}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={actions.openFileDialog}
            >
              <UploadIcon aria-hidden="true" />
              {labels.browse}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <SelectedFile item={selected} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={labels.remove}
              onClick={() => actions.removeFile(selected.id)}
            >
              <XIcon aria-hidden="true" />
            </Button>
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
