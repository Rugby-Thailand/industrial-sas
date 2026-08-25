"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
  readonly fallback: (failure: unknown) => ReactNode;

  readonly resetKey: string;

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
    this.props.onFailure?.(failure);
  }

  public override render(): ReactNode {
    if (this.state.caught) return this.props.fallback(this.state.failure);
    return this.props.children;
  }
}
