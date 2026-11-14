"use client";

import { useLayoutEffect, useRef } from "react";
import { JobScanAcquisition, type AcquisitionPorts } from "./acquisition";

/** The keyed JobScanWorkflow gives this hook its actor/warehouse lifetime. */
export function useJobScanAcquisition(ports: AcquisitionPorts) {
  const committed = useRef(ports);
  const controller = useRef<JobScanAcquisition | null>(null);
  useLayoutEffect(() => {
    committed.current = ports;
  });
  useLayoutEffect(() => {
    const acquisition = new JobScanAcquisition({
      prepare: (...args) => committed.current.prepare(...args),
      toDataUrl: (file) => committed.current.toDataUrl(file),
      extract: (imageUrl) => committed.current.extract(imageUrl),
      upload: (file) => committed.current.upload(file),
      createObjectURL: (file) => committed.current.createObjectURL(file),
      revokeObjectURL: (url) => committed.current.revokeObjectURL(url),
      addTicket: (ticket) => committed.current.addTicket(ticket),
      updateTicket: (...args) => committed.current.updateTicket(...args),
      onUploadError: (error) => committed.current.onUploadError(error),
    });
    controller.current = acquisition;
    return () => {
      controller.current = null;
      acquisition.dispose();
    };
  }, []);

  return {
    acquire: (file: File) => controller.current?.acquire(file),
    release: (key: string) => controller.current?.release(key),
  };
}
