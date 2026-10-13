/** Mounted controllers and closed identities for existing native query entries. */
const controllers = new Map<string, number>();
const retired = new Map<string, string>();
let routeGeneration = 0;
export const WORKFLOW_CONTROLLERS_EVENT = "app-workflow-controllers";
export function workflowRouteChanged(): void {
  routeGeneration++;
}
export function registerWorkflowController(key: string): () => void {
  const path = window.location.pathname;
  controllers.set(key, (controllers.get(key) ?? 0) + 1);
  retired.delete(key);
  window.dispatchEvent(new Event(WORKFLOW_CONTROLLERS_EVENT));
  return () => {
    const count = (controllers.get(key) ?? 1) - 1;
    if (count > 0) {
      controllers.set(key, count);
      return;
    }
    controllers.delete(key);
    const generation = routeGeneration;
    const retire = () => {
      if (
        generation !== routeGeneration ||
        window.location.pathname !== path ||
        controllers.has(key)
      )
        return;
      retired.set(key, path);
      window.dispatchEvent(new Event(WORKFLOW_CONTROLLERS_EVENT));
    };
    if (
      window.location.pathname === path &&
      !new URLSearchParams(window.location.search).has(key)
    )
      retire();
    // React's cleanup/setup commit can re-register the same controller. Wait
    // for that commit, then retire before paint exposes an invisible step.
    else queueMicrotask(retire);
    window.dispatchEvent(new Event(WORKFLOW_CONTROLLERS_EVENT));
  };
}
export function hasWorkflowController(key: string): boolean {
  return controllers.has(key);
}
export function isRetiredWorkflowController(
  key: string,
  path: string,
): boolean {
  return retired.get(key) === path;
}
