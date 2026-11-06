import { useLayoutEffect, useRef, useState } from "react";

export type ChartPhase = "exit" | "waiting" | "enter" | "ready";
type View<T> = { authority: string | null; key: string; data: T | null; phase: ChartPhase; stamp: number; signature: string | null };

/** Bounded presentation memory, never a reader/cache or an authorization grant. */
export function useChartTransition<T extends object>(authority: string | null, target: string, confirmed: { key: string; value: T; signature: string } | null) {
  const candidate=confirmed?.key===target?confirmed:null;
  const signature=candidate?.signature??null;
  const stable=useRef({authority,target,signature,data:candidate?.value??null});
  if(stable.current.authority!==authority||stable.current.target!==target||stable.current.signature!==signature)stable.current={authority,target,signature,data:candidate?.value??null};
  const data=stable.current.data;
  const [view, setView] = useState<View<T>>(() => ({ authority, key: target, data: authority ? data : null, phase: data && authority ? "enter" : "waiting", stamp: 0, signature }));
  const current = useRef(view);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const token = ++generation.current;
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reduced = typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const publish = (next: View<T>) => { if (active) { current.current = next; setView(next); } };
    const install = () => {
      publish({ authority, key: target, data: authority ? data : null, phase: authority && data ? reduced ? "ready" : "enter" : "waiting", stamp: token, signature });
      if (authority && data && !reduced) timers.push(setTimeout(() => publish({ authority, key: target, data, phase: "ready", stamp: token, signature }), 300));
    };
    const before = current.current;
    if (authority && before.authority === authority && before.data && !reduced && (before.key !== target || before.signature !== signature)) {
      publish({ ...before, phase: "exit", stamp: token });
      timers.push(setTimeout(install, 120));
    } else install();
    return () => { active = false; timers.forEach(clearTimeout); };
  }, [authority, target, data, signature]);
  // Permission/session/backend/branch changes never get an exit-retention frame.
  if (!authority || view.authority !== authority) return { data: authority ? data : null, phase: data && authority ? "enter" as const : "waiting" as const, stamp: -1 };
  return { data: view.data, phase: view.phase, stamp: view.stamp };
}
