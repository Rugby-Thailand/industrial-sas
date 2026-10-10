"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  barcodeImageProblem,
  decodeBarcodeImage,
  type BarcodeCrop,
  type BarcodeImageError,
} from "./barcodeDecoder";

const initialCrop: BarcodeCrop = { x: 0.1, y: 0.25, width: 0.8, height: 0.5 };

/** Image acquisition has its own cancellation; pausing the camera never closes its owner. */
export function useBarcodeImage(
  onCode: (code: string) => void,
  disabled: boolean,
) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [request, setRequest] = useState<{
    file: File;
    crop?: BarcodeCrop;
    version: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<BarcodeImageError>();
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState(initialCrop);
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    if (disabled) {
      setRequest(undefined);
      setBusy(false);
      setCodes([]);
      setFile(undefined);
      setPreview(undefined);
      setError(undefined);
    }
  }
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | undefined>(undefined);
  const deliver = useEffectEvent((code: string) => {
    if (!disabled) onCode(code);
  });

  const cancel = useCallback(() => {
    version.current++;
    controller.current?.abort();
    setRequest(undefined);
    setBusy(false);
    setCodes([]);
    setError(undefined);
    setFile(undefined);
    setPreview(undefined);
    setCropping(false);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined;
  }, []);

  useEffect(() => {
    if (disabled) {
      version.current++;
      controller.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = undefined;
    }
  }, [disabled]);

  useEffect(() => {
    if (!request || disabled) return;
    const abort = new AbortController();
    controller.current = abort;
    const current = () =>
      !abort.signal.aborted && version.current === request.version;
    void decodeBarcodeImage(request.file, {
      signal: abort.signal,
      ...(request.crop ? { crop: request.crop } : {}),
    })
      .then((values) => {
        if (!current()) return;
        setCodes(values);
        setError(values.length ? undefined : "imageNoBarcode");
        if (values.length === 1) deliver(values[0]!);
      })
      .catch((cause: unknown) => {
        if (!current()) return;
        const message = cause instanceof Error ? cause.message : "";
        setError(
          message === "imageSize" || message === "imageType"
            ? message
            : "imageUnreadable",
        );
      })
      .finally(() => {
        if (current()) setBusy(false);
      });
    return () => abort.abort();
  }, [request, disabled]);

  useEffect(
    () => () => {
      version.current++;
      controller.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  function read(selected: File, selectedCrop?: BarcodeCrop) {
    controller.current?.abort();
    const next = ++version.current;
    setBusy(true);
    setCodes([]);
    setError(undefined);
    setRequest({
      file: selected,
      version: next,
      ...(selectedCrop ? { crop: selectedCrop } : {}),
    });
  }
  function select(selected: File) {
    if (disabled) return;
    cancel();
    const problem = barcodeImageProblem(selected);
    if (problem) {
      setError(problem);
      return;
    }
    const url = URL.createObjectURL(selected);
    previewUrl.current = url;
    setFile(selected);
    setPreview(url);
    setCrop(initialCrop);
    read(selected);
  }
  return {
    file,
    preview,
    busy,
    codes,
    error,
    crop,
    cropping,
    setCrop,
    setCropping,
    select,
    cancel,
    retry: () => {
      if (file && !disabled) read(file, cropping ? crop : undefined);
    },
    accept: (code: string) => {
      if (!disabled && codes.includes(code)) onCode(code);
    },
  };
}
