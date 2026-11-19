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
    const acquisition = new JobScanAcquisition(() => committed.current);
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
