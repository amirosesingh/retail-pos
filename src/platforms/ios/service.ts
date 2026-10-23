import type { BundleInfo, CapacitorUpdaterPlugin } from "@capgo/capacitor-updater";
import {
  fetchManifest,
  inRollout,
  newer,
  validateManifest,
  type Manifest,
  type Trust,
} from "./manifest";
export type Phase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "ready"
  | "installing"
  | "error";
export type Snapshot = {
  phase: Phase;
  installed: string;
  latest?: Manifest;
  progress?: number;
  error?: string;
  deferred?: string;
  healthIssue?: string;
};
type Saved = {
  highest: string;
  failed: string[];
  pending?: string;
  previous?: { id: string; version: string };
  device: string;
  silentDownload: boolean;
  /** Set when the user explicitly changes automatic download in Settings. */
  downloadPreferenceSet?: boolean;
  autoInstall: boolean;
  healthMonitor?: boolean;
};
export type Dependencies = {
  /** Version generated into the IPA's web bundle by the release pipeline. */
  builtinVersion?: string;
  updater: Pick<
    CapacitorUpdaterPlugin,
    "notifyAppReady" | "current" | "getFailedUpdate" | "download" | "set" | "reset" | "addListener"
  >;
  trust: () => Promise<Trust>;
  load: () => Promise<Saved | null>;
  save: (saved: Saved) => Promise<void>;
  safe: () => boolean;
  preserve: () => Promise<void>;
  online: () => boolean;
  fetch?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
};
export class IosOtaService {
  state: Snapshot = { phase: "idle", installed: "Built-in IPA" };
  private listeners = new Set<() => void>();
  private saved!: Saved;
  private trust!: Trust;
  private bundle?: BundleInfo;
  private busy = false;
  private lastCheck = 0;
  private bootPromise?: Promise<void>;
  constructor(private d: Dependencies) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private patch(value: Partial<Snapshot>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((fn) => fn());
  }
  private fail(error: unknown) {
    this.patch({
      phase: "error",
      error:
        error instanceof Error
          ? error.message
          : "Update failed. Free storage and check connectivity, then retry.",
    });
  }
  boot() {
    return (this.bootPromise ??= this.initialize());
  }
  private async initialize() {
    // First native call: no HTTP, auth, database or configuration dependency.
    await this.d.updater.notifyAppReady();
    this.trust = await this.d.trust();
    const current = await this.d.updater.current();
    const installed =
      current.bundle.id === "builtin"
        ? this.d.builtinVersion ?? this.trust.nativeVersion
        : current.bundle.version;
    const loaded = await this.d.load();
    this.saved = loaded ?? {
      highest: installed,
      failed: [],
      device: crypto.randomUUID(),
      silentDownload: true,
      autoInstall: false,
    };
    // Earlier app builds defaulted to no background download. Adopt the new
    // default once; preserve an explicit opt-out made after this release.
    if (loaded && loaded.downloadPreferenceSet !== true) this.saved.silentDownload = true;
    const failed = await this.d.updater.getFailedUpdate();
    if (failed?.bundle.version) this.saved.failed.push(failed.bundle.version);
    if (this.saved.pending && this.saved.pending !== installed)
      this.saved.failed.push(this.saved.pending);
    this.saved.failed = [...new Set(this.saved.failed)].slice(-100);
    delete this.saved.pending;
    if (newer(installed, this.saved.highest)) this.saved.highest = installed;
    await this.d.save(this.saved);
    this.patch({ installed });
    await this.d.updater.addListener("download", (e) => {
      if (this.state.phase === "downloading" && e.bundle.version === this.state.latest?.version)
        this.patch({ progress: Math.max(0, Math.min(100, e.percent)) });
    });
    await this.d.updater.addListener("updateFailed", (e) => {
      void this.recordFailure(e.bundle.version).catch((error) => this.fail(error));
    });
  }
  private async recordFailure(version: string) {
    this.saved.failed = [...new Set([...this.saved.failed, version])].slice(-100);
    await this.d.save(this.saved);
    this.fail(
      new Error(`Version ${version} failed to initialize. It will not be retried automatically.`),
    );
  }
  async preferences(silentDownload: boolean, autoInstall: boolean, healthMonitor = false) {
    await this.boot();
    this.saved.silentDownload = silentDownload;
    this.saved.downloadPreferenceSet = true;
    this.saved.autoInstall = autoInstall;
    this.saved.healthMonitor = healthMonitor;
    await this.d.save(this.saved);
  }
  settings() {
    return {
      silentDownload: this.saved?.silentDownload ?? true,
      autoInstall: this.saved?.autoInstall ?? false,
      healthMonitor: this.saved?.healthMonitor ?? false,
    };
  }
  reportHealthIssue() {
    if (this.saved?.healthMonitor)
      this.patch({
        healthIssue:
          "An application error was detected. Finish your work, then use Recovery if this release is not working correctly.",
      });
  }
  private async getManifest() {
    if (!this.d.online())
      throw new Error(
        "Offline. Connect to check for updates; your installed interface is still available.",
      );
    const raw = await fetchManifest(this.trust.endpoint, this.trust.origin, this.d.fetch);
    return validateManifest(raw, this.trust, this.state.installed, this.saved.highest);
  }
  async check(manual = false) {
    await this.boot();
    if (this.busy || (!manual && Date.now() - this.lastCheck < 60_000)) return;
    this.busy = true;
    this.lastCheck = Date.now();
    this.patch({ phase: "checking", error: undefined });
    try {
      const m = await this.getManifest();
      if (this.saved.failed.includes(m.version))
        throw new Error(`Version ${m.version} previously failed. Waiting for a corrected release.`);
      if (!newer(m.version, this.state.installed) || !(await inRollout(m, this.saved.device))) {
        this.bundle = undefined;
        this.patch({ phase: "idle", latest: undefined });
        return;
      }
      this.patch({
        latest: m,
        phase:
          this.bundle?.version === m.version && this.bundle.checksum === m.checksum
            ? "ready"
            : "available",
      });
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
    if (this.state.phase === "available" && this.saved.silentDownload) await this.download();
    else if (this.state.phase === "ready" && this.saved.autoInstall) await this.install();
  }
  async download() {
    await this.boot();
    if (this.busy || !this.state.latest) return;
    this.busy = true;
    try {
      const m = await this.getManifest();
      if (
        m.version !== this.state.latest.version ||
        this.saved.failed.includes(m.version) ||
        !(await inRollout(m, this.saved.device))
      )
        throw new Error("Release changed or was stopped. Check again.");
      this.patch({ latest: m, phase: "downloading", progress: 0, error: undefined });
      for (let attempt = 0; ; attempt++) {
        try {
          this.bundle = await this.d.updater.download({
            url: m.url,
            version: m.version,
            checksum: m.checksum,
          });
          break;
        } catch (error) {
          // Never retry integrity, ZIP, storage or permission errors as network failures.
          const message = String(error instanceof Error ? error.message : error);
          if (
            attempt >= 2 ||
            !/network|timeout|connection|offline|interrupted/i.test(message) ||
            /checksum|signature|zip|storage|space/i.test(message)
          )
            throw error;
          await (this.d.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
            1000 * 2 ** attempt,
          );
        }
      }
      this.patch({ phase: "verifying", progress: 100 });
      if (
        this.bundle.checksum.toLowerCase() !== m.checksum ||
        this.bundle.version !== m.version ||
        this.bundle.status === "error"
      ) {
        this.bundle = undefined;
        throw new Error("Downloaded bundle failed checksum or archive validation.");
      }
      this.patch({ phase: "ready" });
    } catch (error) {
      this.bundle = undefined;
      this.fail(error);
    } finally {
      this.busy = false;
    }
    if (this.state.phase === "ready" && this.saved.autoInstall) await this.install();
  }
  async install() {
    await this.boot();
    if (this.busy || !this.bundle || this.state.phase !== "ready") return;
    if (!this.d.safe()) {
      this.patch({ deferred: "Finish and save your work, then open Software updates to install." });
      return;
    }
    this.busy = true;
    try {
      const m = await this.getManifest();
      if (
        m.version !== this.bundle.version ||
        m.checksum !== this.bundle.checksum.toLowerCase() ||
        !(await inRollout(m, this.saved.device))
      )
        throw new Error("Release changed or was stopped; installation cancelled.");
      await this.d.preserve();
      if (!this.d.safe())
        throw new Error("Installation deferred because the active screen changed.");
      const previous = await this.d.updater.current();
      this.saved.previous = { id: previous.bundle.id, version: this.state.installed };
      this.saved.pending = m.version;
      await this.d.save(this.saved);
      this.patch({ phase: "installing", deferred: undefined });
      return await this.d.updater.set({ id: this.bundle.id }); // FINAL operation: WebView reloads here.
    } catch (error) {
      this.busy = false;
      this.fail(error);
    }
  }
  async restore(builtin: boolean, confirmed: boolean) {
    await this.boot();
    if (!confirmed || this.busy || !this.d.safe()) return;
    this.busy = true;
    try {
      await this.d.preserve();
      if (!this.d.safe()) throw new Error("Finish your work before restoring.");
      if (this.state.installed !== (this.d.builtinVersion ?? this.trust.nativeVersion))
        this.saved.failed.push(this.state.installed);
      await this.d.save(this.saved);
      this.patch({ phase: "installing" });
      if (!builtin && this.saved.previous && this.saved.previous.id !== "builtin") {
        return await this.d.updater.set({ id: this.saved.previous.id });
      }
      return await this.d.updater.reset({ toLastSuccessful: !builtin && !this.saved.previous });
    } catch (error) {
      this.busy = false;
      this.fail(error);
    }
  }
}
