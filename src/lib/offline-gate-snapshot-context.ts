import { Activity, createContext, createElement, useContext, useEffect, useLayoutEffect, type ComponentType, type ReactNode } from "react";

type ReportSnapshot = (scope: string | null) => () => void;
export const OfflineGateSnapshotContext = createContext<ReportSnapshot | null>(null);
export const OfflineGatePortalContext = createContext<{
  container: HTMLElement | null;
  visibleDepth: number;
  revision: number;
  isPaused: () => boolean;
  registerDepth: (depth: number) => () => void;
} | null>(null);
const PortalDepthContext = createContext(0);
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Clear obsolete scope before paint; unmount cannot retain an old operator. */
export function useOfflineGateSnapshot(scope: string | null): void {
  const report = useContext(OfflineGateSnapshotContext);
  useClientLayoutEffect(() => report?.(scope), [report,scope]);
}

function createGateBoundary<P extends object>(Component: ComponentType<P>, portal: boolean) {
  return function OfflineGateBoundary(props: P) {
    const gate = useContext(OfflineGatePortalContext);
    const depth = useContext(PortalDepthContext);
    useClientLayoutEffect(() => gate?.registerDepth(depth), [gate?.registerDepth, depth]);
    if (!gate) return createElement(Component, props);
    // Never briefly mount a protected popup into document.body before its
    // gate's host ref is available. Outside this provider portals are unchanged.
    if (!gate.container) return null;
    return createElement(Activity, {
      mode: depth > gate.visibleDepth ? "hidden" : "visible",
      children: createElement(PortalDepthContext.Provider, {
        value: depth + 1,
        children: createElement(Component, portal ? { ...props, container: gate.container } : props),
      }),
    });
  };
}

/** Keep popup drafts; suspend popup effects without replacing their components. */
export function createOfflineGatePortal<P extends {
  container?: Element | DocumentFragment | null;
  children?: ReactNode;
}>(Portal: ComponentType<P>) {
  return createGateBoundary(Portal, true);
}

/** Vaul also owns document effects in its Root, above the portal itself. */
export function createOfflineGateBoundary<P extends object>(Component: ComponentType<P>) {
  return createGateBoundary(Component, false);
}

/** A retained Content must not dismiss another layer before its restored
 * document listeners have committed. Outside a gate the primitive is unchanged. */
export function createOfflineGateContent<P extends object>(
  Content: ComponentType<P>,
  events: readonly string[] = ["onEscapeKeyDown", "onPointerDownOutside", "onFocusOutside", "onInteractOutside", "onCloseAutoFocus"],
) {
  return function OfflineGateContent(props: P) {
    const gate = useContext(OfflineGatePortalContext);
    if (!gate) return createElement(Content, props);
    const guarded = { ...props, "data-offline-gate-surface": "" } as Record<string, unknown>;
    for (const name of events) {
      const original = (props as Record<string, unknown>)[name];
      guarded[name] = (event: Event) => {
        if (gate.isPaused()) { event.preventDefault(); return; }
        if (typeof original === "function") original(event);
      };
    }
    // The context revision deliberately re-renders the primitive after its
    // layer registration; a visible DOM node alone does not establish readiness.
    return createElement(Content, guarded as P);
  };
}
