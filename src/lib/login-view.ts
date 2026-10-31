import type { LoginFailure } from "./login-failure";

export type LoginMode = "admin" | "cashier";
export type LoginViewState = Readonly<{
  mode: LoginMode | null;
  error: string;
  failure: LoginFailure | null;
  busy: boolean;
}>;

/** Presentation only. No identifier, credential or authenticated account is retained. */
export function createLoginView() {
  const initial = (): LoginViewState => ({ mode: null, error: "", failure: null, busy: false });
  let state = initial();
  let activeRequest: symbol | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<LoginViewState>) => {
    const next = { ...state, ...patch };
    if (next.mode === state.mode && next.error === state.error && next.failure === state.failure && next.busy === state.busy) return;
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    chooseMode: (mode: LoginMode) => { if (!state.busy) update({ mode, error: "", failure: null }); },
    setError: (error: string) => update({ error, failure: null }),
    beginRequest: () => {
      if (activeRequest) return null;
      activeRequest = Symbol("password-sign-in");
      update({ mode: "admin", busy: true, error: "", failure: null });
      return activeRequest;
    },
    failRequest: (request: symbol, error: string, failure: LoginFailure | null) => {
      if (request === activeRequest) update({ error, failure });
    },
    finishRequest: (request: symbol) => {
      if (request !== activeRequest) return;
      activeRequest = null;
      update({ busy: false });
    },
    reset: () => {
      activeRequest = null;
      update(initial());
    },
  };
}

export type LoginView = ReturnType<typeof createLoginView>;
