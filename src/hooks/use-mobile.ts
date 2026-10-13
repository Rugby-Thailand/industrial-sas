import { useMediaQuery } from "./useMediaQuery";

const MOBILE_BREAKPOINT = 1024;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

export function useIsMobile() {
  return useMediaQuery(QUERY);
}
