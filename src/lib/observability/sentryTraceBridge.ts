let generation = 0;
export function startRouteTrace(url: string) {
  const current = ++generation;
  void import("./sentryClient")
    .then((module) => {
      if (current === generation) module.startRouteTrace(url);
    })
    .catch(() => {});
}
export function finishRouteTrace() {
  ++generation;
  void import("./sentryClient")
    .then((module) => module.finishRouteTrace())
    .catch(() => {});
}
