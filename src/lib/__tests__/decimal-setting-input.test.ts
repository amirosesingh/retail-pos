import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, input: {} as Record<string, unknown> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = initial; return [state.slots[index], (next: unknown) => { state.slots[index] = next; }]; },
  useRef: (initial: unknown) => { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = { current: initial }; return state.slots[index]; },
  useEffect: (effect: () => void) => { state.effects.push(effect); },
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: Record<string, unknown>) => { state.input = props; return createElement("input", props); } }));
import { DecimalSettingInput } from "@/components/ui/decimal-setting-input";
beforeEach(() => { state.slots = []; state.cursor = 0; state.effects = []; });

it.each(["1.5", "1,5"])("keeps the separator while typing %s across controlled rerenders", text => {
  let value = 0;
  const draw = () => { state.cursor = 0; renderToStaticMarkup(createElement(DecimalSettingInput, { value, onValueChange: next => { value = next; } })); state.effects.splice(0).forEach(effect => effect()); };
  draw();
  (state.input.onFocus as (event: object) => void)({});
  for (let end = 1; end <= text.length; end++) {
    const part = text.slice(0, end);
    (state.input.onChange as (event: { target: { value: string } }) => void)({ target: { value: part } });
    draw();
    expect(state.input.value).toBe(part);
  }
  expect(value).toBe(1.5);
  (state.input.onBlur as (event: object) => void)({}); draw();
  expect(state.input.value).toBe("1.5");
});
