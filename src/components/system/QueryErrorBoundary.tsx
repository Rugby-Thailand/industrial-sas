"use client";

/**
 * The boundary that turns a thrown Convex failure into a state.
 *
 * `useQuery` from `convex/react` *throws* when its query errors, and the ledger
 * wrappers throw a `ConvexError` for exactly the case an unconfigured machine
 * hits on every read: no verified identity, so no tenant, so
 * `TENANT_CONTEXT_DENIED` with cause `ANONYMOUS`. Without a boundary that throw
 * unmounts the whole route and the operator gets Next.js's error screen instead
 * of "sign in".
 *
 * A class component because React has no hook equivalent;
 * `getDerivedStateFromError` is the only way to render a fallback for a child's
 * throw.
 *
 * `resetKey` matters. Once a boundary has caught, it stays in its error state
 * until something tells it the input changed — so switching warehouse after a
 * failure would otherwise show the previous warehouse's error forever. Passing
 * the query's identity as the key clears the failure whenever the question
 * changes.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
  readonly fallback: (failure: unknown) => ReactNode;
  /** Changing this discards a caught failure and retries the children. */
  readonly resetKey: string;
  /**
   * Reports the failure. Supplied by the caller rather than resolved here,
   * because a class component cannot read a hook and a module-level singleton
   * would be untestable.
   */
  readonly onFailure?: (failure: unknown) => void;
}

interface State {
  readonly failure: unknown;
  readonly caught: boolean;
  readonly resetKey: string;
}

export class QueryErrorBoundary extends Component<Props, State> {
  public override state: State = {
    failure: undefined,
    caught: false,
    resetKey: this.props.resetKey,
  };

  public static getDerivedStateFromError(failure: unknown): Partial<State> {
    return { failure, caught: true };
  }

  public static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, failure: undefined, caught: false };
  }

  public override componentDidCatch(failure: unknown, _info: ErrorInfo): void {
    /*
     * Reported through `ObservabilityPort` (`INT-05`), never through
     * `console.error`. The distinction matters: the port's event carries a
     * code-owned failure code, a server-minted request ID, and nothing else,
     * whereas a console dump of a `ConvexError` payload is unstructured,
     * unredacted, and impossible to promise anything about under PDPA. The
     * `ErrorInfo` — which holds a component stack — is deliberately not passed
     * on for the same reason.
     */
    this.props.onFailure?.(failure);
  }

  public override render(): ReactNode {
    if (this.state.caught) return this.props.fallback(this.state.failure);
    return this.props.children;
  }
}
