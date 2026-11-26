import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownUp, CalendarClock, Download, Layers3, MapPin, Printer, RefreshCw, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { silentPrint } from "@/lib/receipt-printer";
import { posTimeZone } from "@/lib/time-zone";
import { sessionEpoch } from "@/lib/session-epoch";
import { subscribeSyncState, syncState } from "@/lib/sync-status";
import { effectiveDatabaseMode, preferredDatabaseMode, subscribeDatabaseMode } from "@/core/local-db/db-mode";
import { currentPlatform, isWindowsShell } from "@/platform-config/features";
import { isManagementDevice } from "@/lib/management-device";
import { stockDisplayLocations } from "@/lib/all-shops-stock";
import { sameBranchId } from "@/lib/branch-id";
import { toManagementReportStore, useManagementInventory } from "@/lib/management-inventory-client";
import type { Store } from "@/core/types/pos-types";
import { CurrentInventoryReport } from "./CurrentInventoryReport";
import { StockMovementReport } from "./StockMovementReport";
import { StockReport } from "./StockReport";
import { ThemedSelect } from "./ThemedSelect";

const reportTabs = [
  { id: "current", label: "Current Stock", icon: Layers3 },
  { id: "history", label: "Stock As of Date", icon: CalendarClock },
  { id: "movement", label: "Stock Movement", icon: ArrowDownUp },
  { id: "valuation", label: "Stock Valuation", icon: WalletCards },
] as const;

type ReportTab = typeof reportTabs[number]["id"];
const reportTitle = "Stock Report";
const reportSubtitle = "View inventory balances, historical stock availability and stock movements.";

function displayDate(value: string | null, timeZone: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, {
    timeZone, dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value)) : null;
}

function printableReportTable(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLTableElement>("table[data-stock-report-print-table]"))
    .find(table => !table.closest("[hidden]") && table.tBodies[0]?.rows.length);
}

async function printVisiblePage(panel: HTMLElement, title: string, metadata: string[]) {
  const table = printableReportTable(panel);
  if (!table) return "Generate a report eligible for printing first.";
  const doc = document.implementation.createHTMLDocument(title);
  const stylesheet = doc.createElement("style");
  stylesheet.textContent = `@page{margin:12mm} body{font:12px system-ui,sans-serif;color:#15202b;padding:16px}
    h1{font-size:24px;margin:0 0 12px} p{margin:4px 0;color:#46515c} table{border-collapse:collapse;width:100%;margin-top:16px}
    thead{display:table-header-group} tr{break-inside:avoid} th,td{border-bottom:1px solid #bbc3ca;padding:6px 8px;text-align:left;overflow-wrap:anywhere}
    th{background:#eff2f4} @media print{body{padding:0}}`;
  doc.head.append(stylesheet);
  const heading = doc.createElement("h1");
  heading.textContent = title;
  doc.body.append(heading);
  for (const line of metadata) {
    if (!line) continue;
    const text = doc.createElement("p");
    text.textContent = line;
    doc.body.append(text);
  }
  const printable = doc.createElement("table");
  const head = printable.createTHead(), body = printable.createTBody();
  for (const original of table.rows) {
    if (original.hidden) continue;
    const row = (original.parentElement === table.tHead ? head : body).insertRow();
    for (const source of original.cells) {
      if (source.hidden || source.getAttribute("aria-hidden") === "true") continue;
      const cell = doc.createElement(source.tagName === "TH" ? "th" : "td");
      cell.colSpan = source.colSpan;
      if (source.tagName === "TH") cell.textContent = source.textContent?.trim() ?? "";
      else {
        const contents = source.cloneNode(true) as HTMLElement;
        contents.querySelectorAll("button, input, select, [hidden], [aria-hidden=true]").forEach(item => item.remove());
        cell.textContent = contents.textContent?.trim() ?? "";
      }
      row.append(cell);
    }
  }
  doc.body.append(printable);
  if (isWindowsShell()) {
    const result = await silentPrint(doc.documentElement.outerHTML, "a4", true);
    return result.ok ? "" : "The desktop print dialog could not print this report.";
  }
  const preview = window.open("", "_blank", "popup,width=980,height=760");
  if (!preview) return "Allow the report print window in the browser and try again.";
  preview.opener = null;
  preview.document.replaceChild(preview.document.importNode(doc.documentElement, true), preview.document.documentElement);
  preview.addEventListener("afterprint", () => preview.close(), { once: true });
  preview.focus();
  preview.print();
  return "";
}

function StockReportHeading() {
  return <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{reportTitle}</h1>
    <p className="mt-1 text-sm text-muted-foreground">{reportSubtitle}</p></div>;
}

function ReportWorkspace({ branchId, branchName, canExport, canPrint, canValue, managementLocations }: {
  branchId: string;
  branchName: string;
  canExport: boolean;
  canPrint: boolean;
  canValue: boolean;
  managementLocations?: Store[];
}) {
  const { user, terminalUser, terminalStoreId, canSwitchStores } = useAuth();
  const { state, stores, storesLoaded, ready, loadPhase } = usePos();
  const [tab, setTab] = useState<ReportTab>("current");
  const [historicalLocation, setHistoricalLocation] = useState(branchId);
  const [visited, setVisited] = useState<ReadonlySet<ReportTab>>(() => new Set(["current"]));
  const [historicalValuation, setHistoricalValuation] = useState(false);
  const [visitedHistoricalValuation, setVisitedHistoricalValuation] = useState(false);
  const [revision, setRevision] = useState({ current: 0, history: 0, movement: 0, valuation: 0, valuationHistory: 0 });
  const [actionMessage, setActionMessage] = useState("");
  const [readyPrintView, setReadyPrintView] = useState<string | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const sync = useSyncExternalStore(subscribeSyncState, syncState, syncState);
  const timeZone = posTimeZone() || "Asia/Brunei";
  const web = currentPlatform() === "web";
  const inventoryLoaded = ready && loadPhase === "ready" && storesLoaded;
  const lastSync = web ? null : displayDate(sync.lastSyncAt, timeZone);
  const refreshView = tab === "valuation" && historicalValuation ? "valuationHistory" : tab;
  const reportLocations = managementLocations ?? (storesLoaded ? stockDisplayLocations(stores, { terminalStoreId,
    userStoreId: user?.storeId, currentStoreId: branchId, canSwitchStores }) : []);
  const selectedLocation = reportLocations.find(store => sameBranchId(store.id, historicalLocation));
  const historicalBranchId = selectedLocation?.id ?? branchId;
  const historicalBranchName = selectedLocation?.name ?? branchName;
  const chooseReportLocation = reportLocations.length > 1 && (tab === "history" || tab === "movement" ||
    (tab === "valuation" && historicalValuation));
  const exportSupported = canExport && (tab === "current" || tab === "history" || (tab === "valuation" && !historicalValuation));
  const printSupported = canPrint && refreshView !== "valuationHistory";
  const freshness = web
    ? inventoryLoaded ? "Inventory snapshot loaded"
      : loadPhase === "failed" ? "Inventory unavailable" : "Loading inventory"
    : sync.phase === "offline" ? (isWindowsShell() ? "Offline · local SQL" : "Offline") : sync.lastError
      ? "Synchronization needs attention" : sync.pending > 0 ? "Changes awaiting sync" : sync.phase === "syncing"
        ? "Synchronizing" : lastSync ? "Device sync recorded" : "Sync time unavailable";
  const freshnessColor = web ? inventoryLoaded ? "bg-emerald-500"
    : loadPhase === "failed" ? "bg-amber-500" : "bg-muted-foreground/60"
    : sync.phase === "offline" || sync.lastError || sync.pending > 0 ? "bg-amber-500"
      : lastSync ? "bg-emerald-500" : "bg-muted-foreground/60";
  const activePanel = () => workspace.current?.querySelector<HTMLElement>(`[data-stock-report-panel="${tab}"]:not([hidden])`);

  useEffect(() => {
    if (!printSupported) return;
    const panel = workspace.current?.querySelector<HTMLElement>(`[data-stock-report-panel="${tab}"]:not([hidden])`);
    if (!panel) return;
    const check = () => setReadyPrintView(printableReportTable(panel) ? refreshView : null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-stock-report-print-table", "hidden"] });
    return () => observer.disconnect();
  }, [tab, printSupported, refreshView]);

  function selectTab(value: string) {
    const selected = reportTabs.find(item => item.id === value)?.id;
    if (!selected || (selected === "valuation" && !canValue)) return;
    setTab(selected);
    setVisited(previous => previous.has(selected) ? previous : new Set([...previous, selected]));
    setActionMessage("");
  }

  function goToExport() {
    if (!exportSupported) return;
    const anchor = activePanel()?.querySelector<HTMLElement>("[data-stock-report-export]:not([disabled])");
    if (!anchor) { setActionMessage("Generate a report eligible for export first."); return; }
    anchor.scrollIntoView({ block: "nearest" });
    anchor.focus();
  }

  function printReport() {
    const panel = activePanel();
    if (!printSupported || !panel) return;
    const active = reportTabs.find(item => item.id === tab)!;
    const company = state.settings.receipt?.companyName;
    const person = terminalUser?.name || user?.name;
    const generated = displayDate(new Date().toISOString(), timeZone);
    const summary = panel.querySelector<HTMLElement>("[data-stock-report-print-summary]")?.innerText?.trim().replace(/\s*\n\s*/g, " · ");
    const scope = panel.querySelector<HTMLElement>("[data-stock-report-locations]");
    const selectedLocations = scope?.dataset.stockReportLocations || (tab === "history" || tab === "movement" ? historicalBranchName : branchName);
    const filters = scope?.dataset.stockReportFilters;
    void printVisiblePage(panel, `${reportTitle} · ${active.label}`, [
      company || "", `Locations ${selectedLocations}`, filters ? `Filters ${filters}` : "", generated ? `Generated ${generated} · ${timeZone}` : "",
      person ? `Generated by ${person}` : "", `${freshness}${lastSync ? ` · ${lastSync}` : ""}`,
      summary || "", "Displayed table page.",
    ]).then(message => { if (panel.isConnected && !panel.hidden) setActionMessage(message); }, () => {
      if (panel.isConnected && !panel.hidden) setActionMessage("The report print preview could not open.");
    });
  }

  return <section className="min-w-0 space-y-5" aria-label="Inventory reports">
    <header className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <StockReportHeading />
        <div className="flex flex-wrap gap-2" aria-label="Report actions">
          <Button type="button" variant="outline" onClick={() => {
            setActionMessage(""); setRevision(previous => ({ ...previous, [refreshView]: previous[refreshView] + 1 }));
          }}><RefreshCw aria-hidden="true" /> Refresh</Button>
          {exportSupported && <Button type="button" variant="outline" onClick={goToExport}><Download aria-hidden="true" /> Export</Button>}
          {printSupported && <Button type="button" variant="outline" disabled={readyPrintView !== refreshView} onClick={printReport}
            title="Print the displayed page or save it as PDF"><Printer aria-hidden="true" /> Print</Button>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-foreground"><MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">Active location</span> {branchName}</span>
        {!web && <span>Last successful device sync {lastSync ? <time dateTime={sync.lastSyncAt!} className="font-medium text-foreground">{lastSync} · {timeZone}</time> : "unavailable"}</span>}
        <Badge variant="outline" className="gap-1.5 bg-muted/30 font-medium" aria-label={`${web ? "Inventory data" : "Device data freshness"}, ${freshness}`}>
          <span className={`size-1.5 rounded-full ${freshnessColor}`} aria-hidden="true" />{freshness}
        </Badge>
      </div>
      {actionMessage && <p className="mt-3 text-sm text-muted-foreground" role="status">{actionMessage}</p>}
    </header>
    <div ref={workspace}>
      <Tabs value={tab} onValueChange={selectTab} activationMode="manual">
        <TabsList aria-label="Inventory report types" className="grid h-auto w-full grid-cols-2 gap-1 p-1.5 sm:flex sm:w-fit">
          {reportTabs.filter(item => item.id !== "valuation" || canValue).map(({ id, label, icon: Icon }) =>
            <TabsTrigger key={id} value={id} className="min-h-10 justify-start gap-2 px-2 text-xs sm:justify-center sm:px-4 sm:text-sm">
              <Icon className="size-4 shrink-0" aria-hidden="true" />{label}
            </TabsTrigger>)}
        </TabsList>
        {chooseReportLocation && <Label className="mt-4 block max-w-sm space-y-1">
          <span>Report location</span><ThemedSelect ariaLabel="Report location" value={historicalBranchId}
            options={reportLocations.map(store => ({ value: store.id, label: store.name }))}
            onChange={value => {
              if (!reportLocations.some(store => sameBranchId(store.id, value))) return;
              setHistoricalLocation(value); setActionMessage("");
            }} />
        </Label>}
        <TabsContent value="current" forceMount hidden={tab !== "current"} data-stock-report-panel="current" className="mt-4">
          <CurrentInventoryReport branchId={branchId} branchName={branchName} refreshToken={revision.current} managementLocations={managementLocations} />
        </TabsContent>
        <TabsContent value="history" forceMount hidden={tab !== "history"} data-stock-report-panel="history" className="mt-4">
          {visited.has("history") && <StockReport branchId={historicalBranchId} branchName={historicalBranchName} initialView="history" refreshToken={revision.history} />}
        </TabsContent>
        <TabsContent value="movement" forceMount hidden={tab !== "movement"} data-stock-report-panel="movement" className="mt-4">
          {visited.has("movement") && <StockMovementReport branchId={historicalBranchId} branchName={historicalBranchName} refreshToken={revision.movement} />}
        </TabsContent>
        {canValue && <TabsContent value="valuation" forceMount hidden={tab !== "valuation"} data-stock-report-panel="valuation" className="mt-4 space-y-4">
          {visited.has("valuation") && <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Valuation period">
            <Button type="button" size="sm" variant={historicalValuation ? "outline" : "secondary"} aria-pressed={!historicalValuation}
              onClick={() => { setHistoricalValuation(false); setActionMessage(""); }}>Current valuation</Button>
            <Button type="button" size="sm" variant={historicalValuation ? "secondary" : "outline"} aria-pressed={historicalValuation}
              onClick={() => { setHistoricalValuation(true); setVisitedHistoricalValuation(true); setActionMessage(""); }}>Historical valuation</Button>
          </div>
          <div hidden={historicalValuation}><CurrentInventoryReport branchId={branchId} branchName={branchName} valuation refreshToken={revision.valuation} managementLocations={managementLocations} /></div>
          {visitedHistoricalValuation && <div hidden={!historicalValuation}>
            <StockReport branchId={historicalBranchId} branchName={historicalBranchName} initialView="history" historicalValuation
              refreshToken={revision.valuationHistory} />
          </div>}
          </>}
        </TabsContent>}
      </Tabs>
    </div>
  </section>;
}

function ManagementReportWorkspace({ branchId, canExport, canPrint, canValue }: {
  branchId: string; canExport: boolean; canPrint: boolean; canValue: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const sync = useSyncExternalStore(subscribeSyncState, syncState, syncState);
  const directory = useManagementInventory({ kind: "locations" }, JSON.stringify([attempt, sync.phase, sync.lastSyncAt]));
  const managementLocations = directory?.ok ? directory.locations.map(toManagementReportStore) : [];
  const active = managementLocations.find(location => sameBranchId(location.id, branchId)) ?? managementLocations[0];
  if (!active) return <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5" aria-label="Inventory reports">
    <StockReportHeading />
    <p role="status" className="text-sm text-muted-foreground">{directory === null ? "Checking the Management local inventory…"
      : directory.ok ? "No authorized locations are available in the local inventory replica." : directory.error}</p>
    {directory && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry local inventory</Button>}
  </section>;
  return <ReportWorkspace branchId={active.id} branchName={active.name} managementLocations={managementLocations}
    canExport={canExport} canPrint={canPrint} canValue={canValue} />;
}

export function AdvancedStockReport({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { can, isAdmin, authUserId, appUser, terminalUser, user } = useAuth();
  const mode = useSyncExternalStore(subscribeDatabaseMode, effectiveDatabaseMode, preferredDatabaseMode);
  const windows = isWindowsShell();
  const localManagement = windows && isManagementDevice();
  const mayRead = can("can_view_inventory"), canExport = can("can_export_reports"), canValue = can("can_view_cost_margin");
  const scopeKey = JSON.stringify([branchId, mode, localManagement, sessionEpoch(), authUserId, appUser?.id, terminalUser?.cashierId, user?.staffId, mayRead, canExport, canValue, isAdmin]);
  if (mayRead && localManagement) return <ManagementReportWorkspace key={scopeKey} branchId={branchId}
    canExport={canExport} canPrint={isAdmin && canExport} canValue={canValue} />;
  if (!mayRead || !branchId || (windows && mode !== "local")) {
    return <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5" aria-label="Inventory reports">
      <StockReportHeading />
      <p role="status" className="text-sm text-muted-foreground">{!mayRead ? "Inventory permission is required to view this report."
          : !branchId ? "Choose an authorized location to view its inventory."
          : "Stock Report in Electron requires the local SQL Server database."}</p>
    </section>;
  }
  return <ReportWorkspace key={scopeKey} branchId={branchId} branchName={branchName}
    canExport={canExport} canPrint={isAdmin && canExport} canValue={canValue} />;
}
