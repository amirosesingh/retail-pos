import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  normalizeServerHost,
  parseServerAddress,
  selectDiscoveredServer,
  type DiscoveredSqlServer,
  validateServerEndpoint,
} from "./local-database-server";
import { readCredentials } from "@/lib/pos-credentials";
import {
  mirrorTerminalConfigToDesktop,
  readTerminalConfig,
} from "@/core/activation/terminal-tokens";
import { boundedInputNumber } from "@/lib/number-input";

type Profile = {
  host: string;
  instanceName: string;
  port: number;
  database: string;
  authMode: "windows" | "sql";
  username: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  retentionDays: number;
};
type DbState = {
  state: string;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  profile?: Partial<Profile> | null;
  detail?: { error?: string; status?: string; ready?: boolean } | null;
};
type DatabaseApi = {
  getState(): Promise<DbState>;
  retryStartup?(): Promise<DbState>;
  authorizeSettings?(): Promise<{ ok: boolean; error?: string }>;
  setEnabled(value: boolean): Promise<DbState>;
  listServers(): Promise<{ ok: boolean; servers?: DiscoveredSqlServer[]; error?: string }>;
  testServer(profile: Profile): Promise<Record<string, unknown>>;
  listDatabases(profile: Profile): Promise<{
    ok: boolean;
    databases?: Array<{ name: string; state_desc: string; compatibility_level: number }>;
    error?: string;
  }>;
  validateDatabase(profile: Profile): Promise<Record<string, unknown>>;
  migrateDatabase(profile: Profile): Promise<Record<string, unknown>>;
  migrateSavedDatabase(): Promise<Record<string, unknown>>;
  provisionAndConnect(profile: Profile): Promise<Record<string, unknown>>;
  exportMigrationSql(): Promise<Record<string, unknown>>;
  saveAndConnect(profile: Profile): Promise<Record<string, unknown>>;
  removeConfiguration(): Promise<DbState>;
  subscribe(cb: (state: DbState) => void): () => void;
};
const api = () => (window.pos as unknown as { database?: DatabaseApi })?.database;
async function authorizeDatabaseChange(): Promise<{ ok: boolean; error?: string }> {
  const adopt = window.sqlAdmin?.adoptSession;
  if (!adopt) {
    return {
      ok: false,
      error: "Update the Windows POS app before changing the local database configuration.",
    };
  }
  const result = await adopt(await readCredentials(), readTerminalConfig());
  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error ?? "The signed-in account could not be verified." };
}
const initial: Profile = {
  host: "127.0.0.1",
  instanceName: "",
  port: 1433,
  database: "POS_Local",
  authMode: "windows",
  username: "",
  password: "",
  encrypt: true,
  trustServerCertificate: true,
  connectionTimeoutMs: 15000,
  requestTimeoutMs: 30000,
  retentionDays: 90,
};
const steps = ["Mode", "Server", "Authentication", "Test", "Database", "Validate", "Save"];
export const OPEN_LOCAL_DATABASE_SETTINGS_EVENT = "pos:open-local-database-settings";

export function LocalDatabaseWizard({
  initiallyOpen = false,
  onRecoveryClose,
}: {
  initiallyOpen?: boolean;
  onRecoveryClose?: () => void;
} = {}) {
  const [state, setState] = useState<DbState>({
    state: "disabled",
    enabled: false,
    configured: false,
    connected: false,
  });
  const [profile, setProfile] = useState<Profile>(initial);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [databases, setDatabases] = useState<
    Array<{ name: string; state_desc: string; compatibility_level: number }>
  >([]);
  const [search, setSearch] = useState("");
  const [selectedServer, setSelectedServer] = useState("");
  const [servers, setServers] = useState<DiscoveredSqlServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [migrationExport, setMigrationExport] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    const database = api();
    void database?.getState().then((next) => {
      setState(next);
      if (next.profile) setProfile((old) => ({ ...old, ...next.profile, password: "" }));
      if (initiallyOpen && next.detail?.status === "migration_required") {
        setStep(5);
        setResult(next.detail as Record<string, unknown>);
      }
    });
    return database?.subscribe?.((next) => {
      setState(next);
    });
  }, [initiallyOpen]);
  useEffect(() => {
    const openSettings = () => setOpen(true);
    window.addEventListener(OPEN_LOCAL_DATABASE_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_LOCAL_DATABASE_SETTINGS_EVENT, openSettings);
  }, []);
  const shown = useMemo(
    () => databases.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
    [databases, search],
  );
  const serverValidation = validateServerEndpoint(profile.host, profile.port, profile.instanceName);
  const run = async (work: () => Promise<Record<string, unknown>>) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await work());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  const scanServers = async () => {
    const database = api();
    if (!database) {
      setDiscoveryError("Server discovery is available only in the Windows desktop app.");
      return;
    }
    setScanning(true);
    setDiscoveryError(null);
    try {
      const response = await database.listServers();
      setServers(response.servers ?? []);
      if (!response.ok) setDiscoveryError(response.error ?? "Server discovery did not complete.");
    } catch (error) {
      setServers([]);
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
  };
  const exportMigrations = async () => {
    if (busy) return;
    setBusy(true);
    setMigrationExport(null);
    try {
      setMigrationExport(await api()!.exportMigrationSql());
    } catch (error) {
      setMigrationExport({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  const ok = result?.ok === true;
  const validationHasSchemaDifferences =
    typeof result?.requiredTables === "number" &&
    result.ready !== true &&
    ((Array.isArray(result.missingTables) && result.missingTables.length > 0) ||
      (Array.isArray(result.incompatibleColumns) && result.incompatibleColumns.length > 0) ||
      (Array.isArray(result.differences) && result.differences.length > 0) ||
      result.changeTracking === false);
  const migrationRequired =
    validationHasSchemaDifferences ||
    result?.status === "migration_required" ||
    state.detail?.status === "migration_required";
  const recoveringSavedMigration =
    initiallyOpen && state.configured && state.detail?.status === "migration_required";

  const toggleLocalMode = (enabled: boolean) => {
    if (enabled) {
      setStep(0);
      setResult(null);
      setOpen(true);
      return;
    }
    void authorizeDatabaseChange()
      .then((authorization) => {
        if (!authorization.ok) throw new Error(authorization.error);
        return api()!.setEnabled(false);
      })
      .then((next) => {
        setState(next);
      })
      .catch((error) =>
        setResult({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
  };
  const chooseServer = (host: string) => {
    setSelectedServer(host);
    const server = servers.find(
      (item) => `${item.host}|${item.instanceName ?? ""}|${item.port ?? ""}` === host,
    );
    if (server) setProfile((current) => selectDiscoveredServer(current, server));
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-base">Local Microsoft SQL Server</CardTitle>
          <CardDescription>
            Direct TCP connection from this Windows terminal. SQL Browser, SQLite, and network-wide
            probing are not used.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="local-db-enabled">Use local Microsoft SQL Server</Label>
            <p className="text-sm text-muted-foreground">
              {state.enabled
                ? state.connected
                  ? "Connected"
                  : "Enabled — connection requires attention"
                : "Central Online mode"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {state.configured && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep(0);
                  setOpen(true);
                }}
              >
                Configure
              </Button>
            )}
            <Switch
              id="local-db-enabled"
              checked={state.enabled || open}
              onCheckedChange={toggleLocalMode}
            />
          </div>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) onRecoveryClose?.();
      }}>
        <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Connect directly to Microsoft SQL Server</DialogTitle>
            <DialogDescription>
              Nothing is enabled or saved until the final Prepare database and connect step succeeds.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <ol
              className="grid grid-cols-2 gap-1 text-center text-[11px] sm:grid-cols-4 xl:grid-cols-7"
              aria-label="Database setup steps"
            >
              {steps.map((name, index) => (
                <li
                  key={name}
                  className={
                    index === step ? "font-semibold text-primary" : "text-muted-foreground"
                  }
                  aria-current={index === step ? "step" : undefined}
                >
                  {index + 1}. {name}
                </li>
              ))}
            </ol>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4">
              {step === 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Direct SQL Server mode</p>
                  <p className="text-sm text-muted-foreground">
                    This wizard accepts a hostname, IP address, or named instance. A detected or
                    explicit TCP port is preferred for a direct connection; a named instance can
                    also resolve its port when TCP port is set to 0. It never uses SQLite.
                  </p>
                </div>
              )}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">Detect installed server instances</p>
                        <p className="text-sm text-muted-foreground">
                          Reads this computer’s SQL Server names, services, and TCP registry
                          settings.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={scanning}
                        onClick={() => void scanServers()}
                      >
                        {scanning ? "Scanning…" : "Scan / Detect"}
                      </Button>
                    </div>
                    {discoveryError ? (
                      <p className="text-sm text-destructive" role="alert">
                        {discoveryError}
                      </p>
                    ) : null}
                    <Field label="Detected SQL Server instance">
                      <select
                        aria-label="Detected SQL Server instance"
                        className="h-10 w-full rounded-md border bg-background px-3"
                        value={selectedServer}
                        onChange={(event) => chooseServer(event.target.value)}
                      >
                        <option value="">Select a detected instance…</option>
                        {servers.map((server) => {
                          const key = `${server.host}|${server.instanceName ?? ""}|${server.port ?? ""}`;
                          return (
                            <option key={key} value={key}>
                              {server.label} · {server.status}
                              {server.port ? ` · TCP ${server.port}` : " · enter TCP port"}
                            </option>
                          );
                        })}
                      </select>
                    </Field>
                    {!scanning && servers.length === 0 && !discoveryError ? (
                      <p className="text-sm text-muted-foreground">
                        No scan results yet. Manual hostname or IP entry is always available.
                      </p>
                    ) : null}
                    {selectedServer && (
                      <div className="grid gap-2 rounded bg-muted p-3 text-xs sm:grid-cols-2">
                        <span>
                          Server:{" "}
                          {
                            servers.find(
                              (item) =>
                                `${item.host}|${item.instanceName ?? ""}|${item.port ?? ""}` ===
                                selectedServer,
                            )?.serverName
                          }
                        </span>
                        <span>
                          Instance:{" "}
                          {
                            servers.find(
                              (item) =>
                                `${item.host}|${item.instanceName ?? ""}|${item.port ?? ""}` ===
                                selectedServer,
                            )?.instanceName
                          }
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Server hostname or IP">
                      <Input
                        aria-invalid={Boolean(serverValidation)}
                        value={profile.host}
                        onBlur={() =>
                          setProfile((current) => ({
                            ...current,
                            host: normalizeServerHost(current.host),
                          }))
                        }
                        onChange={(e) => {
                          setSelectedServer("");
                          const parsed = parseServerAddress(e.target.value);
                          setProfile({
                            ...profile,
                            host: parsed.host,
                            instanceName: parsed.instanceName || profile.instanceName,
                            port: parsed.instanceName ? 0 : profile.port,
                          });
                        }}
                      />
                    </Field>
                    <Field label="Named instance (optional)">
                      <Input
                        placeholder="SQLEXPRESS"
                        value={profile.instanceName}
                        onChange={(e) => setProfile({ ...profile, instanceName: e.target.value })}
                      />
                    </Field>
                    <Field label="TCP port">
                      <Input
                        type="number"
                        min={0}
                        max={65535}
                        value={profile.port}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            port: boundedInputNumber(e.target.value, profile.port, 0, 65535, true),
                          })
                        }
                      />
                    </Field>
                    <Toggle
                      label="Encrypt connection"
                      value={profile.encrypt}
                      change={(encrypt) => setProfile({ ...profile, encrypt })}
                    />
                    <Toggle
                      label="Trust server certificate"
                      value={profile.trustServerCertificate}
                      change={(trustServerCertificate) =>
                        setProfile({ ...profile, trustServerCertificate })
                      }
                    />
                    <Field label="Connection timeout (ms)">
                      <Input
                        type="number"
                        value={profile.connectionTimeoutMs}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            connectionTimeoutMs: boundedInputNumber(
                              e.target.value,
                              profile.connectionTimeoutMs,
                              1,
                              300_000,
                              true,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Request timeout (ms)">
                      <Input
                        type="number"
                        value={profile.requestTimeoutMs}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            requestTimeoutMs: boundedInputNumber(
                              e.target.value,
                              profile.requestTimeoutMs,
                              1,
                              300_000,
                              true,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  {serverValidation ? (
                    <p className="text-sm text-destructive" role="alert">
                      {serverValidation}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Use the detected/known TCP port for a direct connection. Use port 0 only when
                      Windows must resolve a named instance such as SERVER\\SQLEXPRESS.
                    </p>
                  )}
                </div>
              )}
              {step === 2 && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      variant={profile.authMode === "windows" ? "default" : "outline"}
                      onClick={() =>
                        setProfile({ ...profile, authMode: "windows", username: "", password: "" })
                      }
                    >
                      Windows Integrated
                    </Button>
                    <Button
                      variant={profile.authMode === "sql" ? "default" : "outline"}
                      onClick={() => setProfile({ ...profile, authMode: "sql" })}
                    >
                      SQL Server Authentication
                    </Button>
                  </div>
                  {profile.authMode === "sql" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Username">
                        <Input
                          autoComplete="username"
                          value={profile.username}
                          onChange={(e) => setProfile({ ...profile, username: e.target.value })}
                        />
                      </Field>
                      <Field label="Password">
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={profile.password}
                          onChange={(e) => setProfile({ ...profile, password: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
              {step === 3 && (
                <Action
                  title="Test direct server connection"
                  text="Tests ODBC Driver 18, TCP, TLS and authentication against master."
                  busy={busy}
                  onClick={() => run(() => api()!.testServer(profile))}
                  result={result}
                />
              )}
              {step === 4 && (
                <div className="space-y-3">
                  <Action
                    title="Load accessible databases"
                    text="Loads databases directly from the authenticated server. System databases are excluded."
                    busy={busy}
                    onClick={() =>
                      run(async () => {
                        const response = await api()!.listDatabases(profile);
                        setDatabases(response.databases ?? []);
                        return response as unknown as Record<string, unknown>;
                      })
                    }
                    result={result}
                  />
                  <Field label="Database to create or update">
                    <Input
                      aria-label="Available database"
                      list="available-local-databases"
                      placeholder="POS_Local"
                      value={profile.database}
                      onChange={(e) => setProfile({ ...profile, database: e.target.value })}
                    />
                    <datalist id="available-local-databases">
                      {shown.map((db) => (
                        <option key={db.name} value={db.name}>
                          {db.name} · {db.state_desc}
                        </option>
                      ))}
                    </datalist>
                  </Field>
                  <Input
                    aria-label="Search databases"
                    placeholder="Filter databases"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
              {step === 5 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    This check is optional. The final action creates the database when it is
                    missing, applies pending migrations, and validates it before connecting.
                  </p>
                  <Action
                    title={`Validate ${profile.database || "selected database"}`}
                    text="Compares tables, columns, types, defaults, indexes, constraints, change tracking, permissions, and a rolled-back write with this application version."
                    busy={busy}
                    onClick={() => run(() => api()!.validateDatabase(profile))}
                    result={result}
                  />
                  {migrationRequired && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void exportMigrations()}
                      >
                        Download migration SQL file
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const authorization = await authorizeDatabaseChange();
                            if (!authorization.ok) return authorization;
                            if (recoveringSavedMigration) return api()!.migrateSavedDatabase();
                            const migrated = await api()!.migrateDatabase(profile);
                            if (!migrated.ok) return migrated;
                            return api()!.validateDatabase(profile);
                          })
                        }
                      >
                        Apply directly and validate again
                      </Button>
                    </div>
                  )}
                  {migrationExport ? <ResultSummary result={migrationExport} /> : null}
                </div>
              )}
              {step === 6 && (
                <div className="space-y-4">
                  <Field label="Local history retention">
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3"
                      value={profile.retentionDays}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          retentionDays: boundedInputNumber(
                            e.target.value,
                            profile.retentionDays,
                            1,
                            7300,
                            true,
                          ),
                        })
                      }
                    >
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={180}>6 months</option>
                      <option value={365}>12 months</option>
                      <option value={730}>24 months</option>
                      <option value={7300}>All history</option>
                    </select>
                  </Field>
                  <Action
                    title="Prepare database and connect"
                    text="Creates the database if needed, applies pending migrations, validates every required table, then seals the password with Windows DPAPI and connects. Existing business rows are not cleared."
                    busy={busy}
                    onClick={() =>
                      run(async () => {
                        const authorization = await authorizeDatabaseChange();
                        if (!authorization.ok) return authorization;
                        await mirrorTerminalConfigToDesktop();
                        const response = await api()!.provisionAndConnect(profile);
                        if (response.ok) {
                          setProfile((old) => ({ ...old, password: "" }));
                          try {
                            setState(await api()!.getState());
                          } catch {
                            // Provisioning already succeeded. The database status subscription
                            // will refresh this view without falsely reporting setup as failed.
                          }
                          setOpen(false);
                        }
                        return response;
                      })
                    }
                    result={result}
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-between gap-2 border-t bg-background pt-3">
              <Button
                variant="outline"
                disabled={step === 0 || busy}
                onClick={() => {
                  setResult(null);
                  setStep((value) => value - 1);
                }}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    step === 6 ||
                    busy ||
                    (step === 1 && Boolean(serverValidation)) ||
                    (step === 3 && !ok) ||
                    (step === 4 && !profile.database)
                  }
                  onClick={() => {
                    setResult(null);
                    setStep((value) => Math.min(6, value + 1));
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
function Toggle({
  label,
  value,
  change,
}: {
  label: string;
  value: boolean;
  change(value: boolean): void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3">
      <Label>{label}</Label>
      <Switch checked={value} onCheckedChange={change} />
    </div>
  );
}
function Action({
  title,
  text,
  busy,
  onClick,
  result,
}: {
  title: string;
  text: string;
  busy: boolean;
  onClick(): void;
  result: Record<string, unknown> | null;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <Button disabled={busy} onClick={onClick}>
        {busy ? "Working…" : title}
      </Button>
      {result && <ResultSummary result={result} />}
    </div>
  );
}

function ResultSummary({ result }: { result: Record<string, unknown> }) {
  if (result.ok === false)
    return (
      <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        <p className="font-medium">{String(result.error ?? "The check failed.")}</p>
        {result.hint ? <p className="mt-1">{String(result.hint)}</p> : null}
        {result.code ? <p className="mt-1 text-xs">Code: {String(result.code)}</p> : null}
      </div>
    );
  if (typeof result.requiredTables === "number")
    return (() => {
      const missingTables = Array.isArray(result.missingTables) ? result.missingTables.map(String) : [];
      const incompatibleColumns = Array.isArray(result.incompatibleColumns) ? result.incompatibleColumns.map(String) : [];
      const differences = Array.isArray(result.differences) ? result.differences as Array<Record<string, unknown>> : [];
      return <div className="space-y-2 rounded-md bg-muted p-3 text-sm" role="status">
        <div className="grid gap-2 sm:grid-cols-2">
          <span>Required tables: {String(result.requiredTables)}</span>
          <span>Present: {String(result.presentTables ?? 0)}</span>
          <span>Missing: {missingTables.length}</span>
          <span>Columns compatible: {result.columnsCompatible ? "Yes" : "No"}</span>
          <span>Write test: {result.writeTest ? "Passed and rolled back" : "Failed"}</span>
          <span>Status: {result.ready ? "Ready" : String(result.status ?? "Migration required")}</span>
        </div>
        {missingTables.length ? <p className="break-words text-xs text-muted-foreground">Missing tables: {missingTables.join(", ")}</p> : null}
        {incompatibleColumns.length ? <p className="break-words text-xs text-muted-foreground">Table changes required: {incompatibleColumns.join(", ")}</p> : null}
        {differences.length ? <div className="max-h-56 space-y-1 overflow-y-auto rounded border bg-background p-2" aria-label="Schema differences">{differences.map((difference, index) => <div key={`${String(difference.kind)}:${String(difference.table)}:${String(difference.object)}:${index}`} className="text-xs"><span className="font-medium">{[difference.kind, difference.table, difference.object].filter(Boolean).map(String).join(" · ")}</span><span className="text-muted-foreground"> — {String(difference.issue ?? "different")}; expected {String(difference.expected ?? "required")}; actual {String(difference.actual ?? "unknown")}</span></div>)}</div> : null}
      </div>
    })();
  if (result.version || result.edition)
    return (
      <div className="grid gap-2 rounded-md bg-muted p-3 text-sm sm:grid-cols-2" role="status">
        <span>SQL Server: {String(result.version ?? "Detected")}</span>
        <span>Edition: {String(result.edition ?? "Unknown")}</span>
        <span>Login: {String(result.loginName ?? "Verified")}</span>
        <span>Latency: {String(result.latencyMs ?? "—")} ms</span>
        <span>List databases: {result.canListDatabases ? "Allowed" : "Not allowed"}</span>
      </div>
    );
  return (
    <p
      className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400"
      role="status"
    >
      {Array.isArray(result.databases)
        ? `${result.databases.length} accessible database${result.databases.length === 1 ? "" : "s"} loaded.`
        : Array.isArray(result.applied)
          ? `${result.applied.length} migration${result.applied.length === 1 ? "" : "s"} applied.`
          : "Completed successfully."}
    </p>
  );
}
