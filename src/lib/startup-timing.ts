export type StartupStage =
  | "authentication"
  | "profile"
  | "roles"
  | "terminal"
  | "location"
  | "essential-pos-ready"
  | "remaining-data-ready";

let startedAt = 0;
const stages = new Map<StartupStage, number>();

const clock = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export function resetStartupTiming(): void {
  startedAt = clock();
  stages.clear();
}

export function markStartupStage(stage: StartupStage): number {
  if (!startedAt) resetStartupTiming();
  const elapsed = Math.max(0, clock() - startedAt);
  stages.set(stage, elapsed);
  if (import.meta.env.DEV) console.debug(`[startup] ${stage}: ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

export function startupTimingSnapshot(): Partial<Record<StartupStage, number>> {
  return Object.fromEntries(stages) as Partial<Record<StartupStage, number>>;
}
