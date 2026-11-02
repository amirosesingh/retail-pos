import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createOfflineGateContent, OfflineGatePortalContext } from "../offline-gate-snapshot-context";

type SurfaceProps = {
  onEscapeKeyDown?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onInteractOutside?: (event: Event) => void;
  title?: string;
  ref?: object;
};

function surfaceFixture(paused?: { current: boolean }) {
  let received: SurfaceProps | undefined;
  const Content = createOfflineGateContent((props: SurfaceProps) => { received = props; return null; });
  const render = (props: SurfaceProps) => {
    const content = createElement(Content, props);
    renderToStaticMarkup(paused ? createElement(OfflineGatePortalContext.Provider, {
      value: { container: null, visibleDepth: Infinity, revision: 1, isPaused: () => paused.current, registerDepth: () => () => {} },
      children: content,
    }) : content);
    return received as ComponentProps<typeof Content>;
  };
  return { render };
}

describe("retained popup dismissal boundary", () => {
  it("passes callbacks, refs and ordinary props unchanged outside a gate", () => {
    const callback = vi.fn();
    const ref = { current: null };
    const received = surfaceFixture().render({ onEscapeKeyDown: callback, onCloseAutoFocus: callback, title: "Original", ref });
    expect(received.onEscapeKeyDown).toBe(callback);
    expect(received.onCloseAutoFocus).toBe(callback);
    expect(received.ref).toBe(ref);
    expect(received.title).toBe("Original");
  });

  it.each(["onEscapeKeyDown", "onCloseAutoFocus", "onInteractOutside"] as const)(
    "pauses %s until restored listeners are ready, without stale captured availability", name => {
      const paused = { current: false };
      const callback = vi.fn();
      const received = surfaceFixture(paused).render({ [name]: callback });
      paused.current = true;
      const duringRecovery = new Event("recovery", { cancelable: true });
      received[name]?.(duringRecovery);
      expect(duringRecovery.defaultPrevented).toBe(true);
      expect(callback).not.toHaveBeenCalled();
      paused.current = false;
      const afterRecovery = new Event("ready", { cancelable: true });
      received[name]?.(afterRecovery);
      expect(afterRecovery.defaultPrevented).toBe(false);
      expect(callback).toHaveBeenCalledExactlyOnceWith(afterRecovery);
    },
  );

  it("preserves an operator callback's explicit preventDefault during normal operation", () => {
    const received = surfaceFixture({ current: false }).render({ onEscapeKeyDown: event => event.preventDefault() });
    const event = new Event("escape", { cancelable: true });
    received.onEscapeKeyDown?.(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
