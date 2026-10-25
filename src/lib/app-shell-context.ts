import { createContext, type Context } from "react";

// A route chunk can retain AppShell across hot updates. Its nesting marker
// must keep the same identity as the persistent root's marker.
const registry = globalThis as typeof globalThis & { __retailAppShellContext?: Context<boolean> };
export const AppShellContext = (registry.__retailAppShellContext ??= createContext(false));
