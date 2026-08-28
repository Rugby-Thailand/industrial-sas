export interface ResponseHeader {
  readonly key: string;
  readonly value: string;
}

const ENFORCED_CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const REPORTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ENFORCED_CSP,
].join("; ");

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=(self)",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

const HSTS = "max-age=86400";

export function securityHeaders(isProduction: boolean): ResponseHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },

    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Content-Security-Policy", value: ENFORCED_CSP },
    {
      key: "Content-Security-Policy-Report-Only",
      value: REPORTED_CSP,
    },
    ...(isProduction
      ? [{ key: "Strict-Transport-Security", value: HSTS }]
      : []),
  ];
}

export const SECURITY_POLICY = {
  ENFORCED_CSP,
  REPORTED_CSP,
  PERMISSIONS_POLICY,
  HSTS,
} as const;
