import type { Event, init } from "@sentry/nextjs";
type InitOptions = NonNullable<Parameters<typeof init>[0]>;
type ErrorEvent = Parameters<NonNullable<InitOptions["beforeSend"]>>[0];
type StreamedSpan = Parameters<NonNullable<InitOptions["beforeSendSpan"]>>[0];
type Transport = ReturnType<NonNullable<InitOptions["transport"]>>;
import { normalizeRoute, redactDimensions } from "./dimensions";
import { sanitizeObservabilityEvent, type ObservabilityEvent } from "./event";

// The SDK adds dynamic sampling context after beforeSend/ beforeSendSpan.
// Its envelope header can contain the original transaction name. Keep only
// protocol identifiers; the sanitized span body still carries its trace ID.
export function privateSentryTransport(transport: Transport): Transport {
  return {
    send: ([header, items]) =>
      transport.send([
        {
          sent_at: new Date().toISOString(),
          ...(typeof header.event_id === "string" &&
          /^[0-9a-f]{32}$/.test(header.event_id)
            ? { event_id: header.event_id }
            : {}),
        },
        items.filter(([item]) => item.type === "event" || item.type === "span"),
      ] as Parameters<Transport["send"]>[0]),
    flush: (timeout) => transport.flush(timeout),
  };
}

const debugId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function framePath(filename: unknown) {
  if (typeof filename !== "string") return undefined;
  const client =
    /\/_next\/static\/chunks\/(?:[0-9a-f_-]+|[0-9a-z_-]{13})\.js$/.exec(
      filename,
    )?.[0];
  const server =
    /\/\.next\/server\/chunks\/(?:ssr\/)?((?:\[root-of-the-server\]__)?[0-9a-z_-]{7,16}(?:\._)?\.js)$/.exec(
      filename,
    );
  return client
    ? `app://${client}`
    : server
      ? `app:///server/${server[1]}`
      : undefined;
}

export function sentryObservabilityEvent(input: ObservabilityEvent): Event {
  const event = sanitizeObservabilityEvent(input);
  return {
    message: event.code,
    level: event.severity,
    tags: redactDimensions(event.dimensions),
  };
}

// Rebuild the outgoing event. SDK enrichment, cookies, business error messages,
// breadcrumbs, user context, headers and request bodies cannot bypass this gate.
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const code =
    event.message &&
    [
      "application.render.failed",
      "workspace.query.failed",
      "observability.code.rejected",
    ].includes(event.message)
      ? event.message
      : "application.unhandled.failed";
  const frames = event.exception?.values
    ?.flatMap((value) => value.stacktrace?.frames ?? [])
    .flatMap((frame) => {
      const path = framePath(frame.filename);
      return path
        ? [
            {
              filename: path,
              ...(debugId(frame.debug_id) ? { debug_id: frame.debug_id } : {}),
              ...(frame.lineno === undefined ? {} : { lineno: frame.lineno }),
              ...(frame.colno === undefined ? {} : { colno: frame.colno }),
            },
          ]
        : [];
    });
  // Native Turbopack debug IDs allow private uploaded source maps to match
  // hashed frames without retaining host names or business URLs.
  const images = event.debug_meta?.images?.flatMap((image) => {
    const path = framePath(image.code_file);
    return image.type === "sourcemap" && path && debugId(image.debug_id)
      ? [
          {
            type: "sourcemap" as const,
            code_file: path,
            debug_id: image.debug_id,
          },
        ]
      : [];
  });
  return {
    type: undefined,
    ...(event.event_id && /^[0-9a-f]{32}$/.test(event.event_id)
      ? { event_id: event.event_id }
      : {}),
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    level: event.level === "warning" ? "warning" : "error",
    message: code,
    ...(event.release && /^[0-9a-f]{40}$/.test(event.release)
      ? { release: event.release }
      : {}),
    tags: redactDimensions(event.tags ?? {}),
    ...(images?.length ? { debug_meta: { images } } : {}),
    ...(frames?.length
      ? {
          exception: {
            values: [{ type: "Error", value: code, stacktrace: { frames } }],
          },
        }
      : {}),
  };
}

export function sanitizeSentrySpan(span: StreamedSpan): StreamedSpan {
  return {
    trace_id: /^[0-9a-f]{32}$/.test(span.trace_id)
      ? span.trace_id
      : "0".repeat(32),
    span_id: /^[0-9a-f]{16}$/.test(span.span_id)
      ? span.span_id
      : "0".repeat(16),
    name: span.name.startsWith("ui.route/")
      ? `ui.route/${normalizeRoute(span.name.slice(9))}`
      : "ui.route/unknown",
    start_timestamp: Number.isFinite(span.start_timestamp)
      ? span.start_timestamp
      : 0,
    ...(span.end_timestamp === undefined
      ? {}
      : {
          end_timestamp: Number.isFinite(span.end_timestamp)
            ? span.end_timestamp
            : 0,
        }),
    status: span.status === "error" ? "error" : "ok",
    is_segment: true,
    attributes: { "sentry.op": "ui.route" },
  };
}
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
} satisfies NonNullable<InitOptions["dataCollection"]>;
